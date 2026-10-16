import hashlib
import json
import os
import re
import selectors
import shlex
import stat
import subprocess
import sys
import time

PARENT = '/home/runner/work/_temp'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC'}
REQUESTS = ['apparmor', 'iproute2', 'util-linux', 'libc6:amd64', 'python3-minimal', 'dpkg']
QUERY = ['--root=/', '--admindir=/var/lib/dpkg', '--no-pager', '--show',
         '--showformat=${binary:Package}\\t${Version}\\t${Architecture}\\t${db:Status-Status}\\n'] + REQUESTS
PREFIXES = ['/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/lib', '/lib64']
ROLES = {
    'osRelease': ['/etc/os-release'],
    'apparmorEnabled': ['/sys/module/apparmor/parameters/enabled'],
    'lsm': ['/sys/kernel/security/lsm'],
    'apparmorFeaturesDirectory': ['/sys/kernel/security/apparmor/features'],
    'aaExec': ['/usr/bin/aa-exec', '/bin/aa-exec'],
    'apparmorParser': ['/usr/sbin/apparmor_parser', '/sbin/apparmor_parser'],
    'ip': ['/usr/sbin/ip', '/sbin/ip'],
    'setpriv': ['/usr/bin/setpriv', '/bin/setpriv'],
    'dpkgQuery': ['/usr/bin/dpkg-query'],
    'python': ['/usr/bin/python3'],
    'systemLoader': ['/lib64/ld-linux-x86-64.so.2'],
}
TEXT = {'osRelease': ['/etc/os-release', '/usr/lib/os-release'],
        'apparmorEnabled': ['/sys/module/apparmor/parameters/enabled'],
        'lsm': ['/sys/kernel/security/lsm']}
FD_RECORDS = []
PENDING_FDS = {}
FIRST = []
SECONDARY = []
BODY_BYTES = 0
INVOCATION = None
ROOT = None
EXPIRED = False
QUERY_CUSTODY = None


class Refusal(Exception):
    pass


class CandidateDrift(Refusal):
    pass


def remember(reason):
    if not FIRST:
        FIRST.append(reason)
    elif reason is not FIRST[0] and len(SECONDARY) < 32:
        SECONDARY.append(reason)


def failure(reason):
    return {'type': type(reason).__name__, 'errno': getattr(reason, 'errno', None)}


def identity(st):
    return {name: str(getattr(st, 'st_' + name)) for name in
            ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtime_ns', 'ctime_ns']}


def check():
    global EXPIRED
    if INVOCATION is None:
        return
    if time.time_ns() >= INVOCATION['deadlineAtMs'] * 1000000 or time.monotonic_ns() >= int(INVOCATION['deadlineMonotonicNs']):
        EXPIRED = True
        raise Refusal('ORIGINAL_ENDPOINT_EXPIRED')


def opened(path, flags, role, mode=0o600, ordinary_denied=False):
    check()
    assert len(FD_RECORDS) < 128
    record = {'path': path, 'role': role, 'openAttempted': True, 'acquired': False,
              'bytes': 0, 'closeAttempted': False, 'closeReturned': False}
    FD_RECORDS.append(record)
    try:
        fd = os.open(path, flags | os.O_NOFOLLOW, mode)
        record['acquired'] = True
        record['fd'] = fd
        PENDING_FDS[fd] = record
        return record
    except BaseException as reason:
        record['error'] = failure(reason)
        if not ordinary_denied or not isinstance(reason, PermissionError):
            remember(reason)
        raise


def closed(record):
    if not record['acquired'] or record['closeAttempted']:
        return
    record['closeAttempted'] = True
    try:
        os.close(record['fd'])
        record['closeReturned'] = True
        del PENDING_FDS[record['fd']]
    except BaseException as reason:
        record['closeError'] = failure(reason)
        remember(reason)


def read_file(path, cap, role, binary=False, ordinary_denied=False, expected_physical=None):
    global BODY_BYTES
    check()
    before = os.lstat(path)
    if expected_physical is not None and identity(before) != expected_physical:
        raise CandidateDrift('BEFORE_READ_IDENTITY_DRIFT')
    assert stat.S_ISREG(before.st_mode)
    record = opened(path, os.O_RDONLY, role, ordinary_denied=ordinary_denied)
    digest = hashlib.sha256()
    body = bytearray()
    try:
        if identity(os.fstat(record['fd'])) != identity(before):
            raise CandidateDrift('OPENED_FILE_IDENTITY_DRIFT')
        while True:
            check()
            allowance = cap - record['bytes']
            # A one-byte terminal read distinguishes exact-cap EOF from overflow.
            chunk = os.read(record['fd'], min(65536, allowance + 1))
            record['bytes'] += len(chunk)
            BODY_BYTES += len(chunk)
            check()
            if record['bytes'] > cap or BODY_BYTES > 268435456:
                raise Refusal('BODY_CAP')
            if not chunk:
                break
            digest.update(chunk)
            if not binary:
                body.extend(chunk)
        if identity(os.fstat(record['fd'])) != identity(before):
            raise CandidateDrift('READ_FILE_IDENTITY_DRIFT')
    except BaseException as reason:
        if not ordinary_denied or not isinstance(reason, PermissionError):
            remember(reason)
        raise
    finally:
        closed(record)
    assert record['closeReturned']
    if identity(os.lstat(path)) != identity(before):
        raise CandidateDrift('CLOSED_FILE_IDENTITY_DRIFT')
    check()
    return {'path': path, 'bytes': record['bytes'], 'sha256': digest.hexdigest(),
            'physical': identity(before)}, bytes(body)


def resolve(candidate):
    queue = [(part, index == len(candidate.split('/')) - 2)
             for index, part in enumerate(candidate.split('/')[1:])]
    current = '/'
    links = []
    steps = []
    seen = set()
    while queue:
        check()
        part, original_leaf = queue.pop(0)
        assert part and part not in ['.', '..']
        path = os.path.join(current, part)
        try:
            st = os.lstat(path)
        except FileNotFoundError as reason:
            return {'candidate': candidate, 'status': 'ABSENT' if original_leaf and not queue else 'HELD',
                    'reason': 'FINAL_ABSENT' if original_leaf and not queue else 'UNRESOLVED_TARGET',
                    'errno': reason.errno, 'links': links, 'steps': steps}
        except PermissionError as reason:
            return {'candidate': candidate, 'status': 'DENIED', 'errno': reason.errno, 'links': links, 'steps': steps}
        steps.append({'path': path, 'physical': identity(st)})
        if stat.S_ISLNK(st.st_mode):
            if len(links) >= 8 or path in seen:
                return {'candidate': candidate, 'status': 'HELD', 'reason': 'LINK_BOUND_OR_LOOP', 'links': links, 'steps': steps}
            seen.add(path)
            literal = os.readlink(path)
            assert len(os.fsencode(literal)) <= 4096
            links.append({'path': path, 'literal': literal, 'physical': identity(st)})
            if identity(os.lstat(path)) != identity(st):
                return {'candidate': candidate, 'status': 'DRIFT', 'reason': 'LINK_IDENTITY_DRIFT',
                        'links': links, 'steps': steps}
            target = os.path.normpath(literal if os.path.isabs(literal) else os.path.join(current, literal))
            queue = [(value, False) for value in target.split('/')[1:]] + queue
            current = '/'
        else:
            if queue and not stat.S_ISDIR(st.st_mode):
                return {'candidate': candidate, 'status': 'HELD', 'reason': 'NON_DIRECTORY_COMPONENT', 'links': links, 'steps': steps}
            current = path
    physical = identity(os.lstat(current))
    if steps and steps[-1]['path'] == current and physical != steps[-1]['physical']:
        return {'candidate': candidate, 'status': 'DRIFT', 'reason': 'FINAL_IDENTITY_DRIFT',
                'canonical': current, 'physical': steps[-1]['physical'], 'links': links, 'steps': steps}
    return {'candidate': candidate, 'status': 'OBSERVED', 'canonical': current,
            'physical': physical, 'links': links, 'steps': steps}


def observe(role, candidate):
    record = resolve(candidate)
    if record['status'] != 'OBSERVED':
        return record
    path = record['canonical']
    st = os.lstat(path)
    if role == 'apparmorFeaturesDirectory':
        if not stat.S_ISDIR(st.st_mode):
            record.update(status='HELD', reason='SPECIAL_DIRECTORY_TARGET')
        else:
            record['readableAdvisory'] = os.access(path, os.R_OK)
    elif not stat.S_ISREG(st.st_mode):
        record.update(status='HELD', reason='SPECIAL_FINAL_TARGET')
    elif role in TEXT and path not in TEXT[role]:
        record.update(status='HELD', reason='TEXT_TARGET_OUTSIDE_CLOSED_DOMAIN')
    elif role not in TEXT and not any(path.startswith(prefix + '/') for prefix in PREFIXES):
        record.update(status='HELD', reason='BINARY_TARGET_OUTSIDE_CLOSED_DOMAIN')
    check()
    fresh = resolve(candidate)
    if fresh['status'] != 'OBSERVED':
        record.update(status='DRIFT' if fresh['status'] in ['ABSENT', 'DRIFT'] else 'HELD',
                      reason='PATH_DRIFT' if fresh['status'] in ['ABSENT', 'DRIFT'] else 'FRESH_PATH_UNRESOLVED')
        return record
    for key in ['canonical', 'physical', 'links', 'steps']:
        if fresh.get(key) != record.get(key):
            record.update(status='DRIFT', reason='PATH_DRIFT')
            return record
    return record


def revalidate_candidate(record):
    fresh = resolve(record['candidate'])
    if fresh['status'] != 'OBSERVED':
        record.update(status='DRIFT' if fresh['status'] in ['ABSENT', 'DRIFT'] else 'HELD',
                      reason='PATH_DRIFT' if fresh['status'] in ['ABSENT', 'DRIFT'] else 'FRESH_PATH_UNRESOLVED')
        return False
    for key in ['canonical', 'physical', 'links', 'steps']:
        if fresh.get(key) != record.get(key):
            record.update(status='DRIFT', reason='PATH_DRIFT')
            return False
    return True


def read_observation(role, record):
    assert record['status'] == 'OBSERVED'
    path = record['canonical']
    if not revalidate_candidate(record):
        return record
    if role != 'apparmorFeaturesDirectory':
        try:
            pin, body = read_file(path, 65536 if role in TEXT else 67108864, 'candidate:' + role,
                                  role not in TEXT, ordinary_denied=True, expected_physical=record['physical'])
        except CandidateDrift:
            record.update(status='DRIFT', reason='BODY_IDENTITY_DRIFT')
            if PENDING_FDS:
                raise
            return record
        except PermissionError as reason:
            record.update(status='DENIED', errno=reason.errno)
        else:
            if not revalidate_candidate(record):
                return record
            record['pin'] = pin
            if role == 'osRelease':
                selected = {}
                for line in body.decode('utf-8', 'strict').splitlines():
                    key, separator, value = line.partition('=')
                    if key in ['ID', 'VERSION_ID', 'PRETTY_NAME']:
                        assert separator and key not in selected
                        tokens = shlex.split(value, comments=False, posix=True)
                        assert len(tokens) == 1
                        selected[key] = tokens[0]
                record['selectedFields'] = selected
            elif role in TEXT:
                record['text'] = body.decode('utf-8', 'strict')
    check()
    if not revalidate_candidate(record):
        for key in ['pin', 'text', 'selectedFields']:
            record.pop(key, None)
    return record


def parse_query(body, returncode):
    text = body.decode('ascii', 'strict')
    assert '\x00' not in text and '\r' not in text
    assert not text or text.endswith('\n')
    rows = {}
    allowed = ['not-installed', 'config-files', 'half-installed', 'unpacked', 'half-configured',
               'triggers-awaited', 'triggers-pending', 'installed']
    for line in text.splitlines():
        fields = line.split('\t')
        assert len(fields) == 4
        name, version, architecture, status_word = fields
        assert architecture in ['amd64', 'all'] and status_word in allowed
        if name == 'libc6:amd64':
            requested = name
            assert architecture == 'amd64'
        else:
            requested = name.split(':')[0]
            assert requested in REQUESTS and requested != 'libc6:amd64'
            assert name in [requested, requested + ':' + architecture]
        assert requested not in rows
        assert len(version) <= 1024 and all(33 <= ord(c) <= 126 for c in version)
        assert version or status_word != 'installed'
        rows[requested] = {'name': name, 'version': version or None, 'architecture': architecture,
                           'status': status_word}
    assert len(rows) <= 6 and returncode in [0, 1]
    if returncode == 0:
        assert set(rows) == set(REQUESTS)
    for name in REQUESTS:
        rows.setdefault(name, {'name': name, 'version': None, 'architecture': None, 'status': 'UNAVAILABLE'})
    return rows


def package_query():
    global QUERY_CUSTODY
    check()
    assert QUERY_CUSTODY is None
    owner = {'program': '/usr/bin/dpkg-query', 'args': QUERY, 'suppliedEnvironment': dict(ENV, DPKG_COLORS='never'),
             'spawned': False, 'pid': None, 'reaped': False, 'returncode': None, 'expired': False,
             'selector': {'acquired': False, 'closeAttempted': False, 'closeReturned': False},
             'stdout': {'acquired': False, 'total': 0, 'retained': 0, 'dropped': 0, 'eof': False, 'closeAttempted': False, 'closeReturned': False},
             'stderr': {'acquired': False, 'total': 0, 'retained': 0, 'dropped': 0, 'eof': False, 'closeAttempted': False, 'closeReturned': False}}
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    custody = {'record': owner, 'child': None, 'streams': {}, 'selector': None, 'buffers': buffers}
    QUERY_CUSTODY = custody
    primary = None
    cleanup_error = None
    try:
        child = subprocess.Popen(['/usr/bin/dpkg-query'] + QUERY, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=owner['suppliedEnvironment'], cwd=ROOT)
        custody['child'] = child
        owner.update(spawned=True, pid=child.pid)
        for label, stream in [('stdout', child.stdout), ('stderr', child.stderr)]:
            custody['streams'][label] = stream
            owner[label]['acquired'] = stream is not None
        assert all(custody['streams'].values())
        selector = selectors.DefaultSelector()
        custody['selector'] = selector
        owner['selector']['acquired'] = True
        for label, stream in custody['streams'].items():
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, label)
        while selector.get_map():
            try:
                check()
            except Refusal as reason:
                remember(reason)
                owner['expired'] = True
            timeout = None if owner['expired'] else max(0, min(0.1, (int(INVOCATION['deadlineMonotonicNs']) - time.monotonic_ns()) / 1e9))
            for key, _ in selector.select(timeout):
                label, stream = key.data, key.fileobj
                chunk = os.read(stream.fileno(), 65536)
                state = owner[label]
                state['total'] += len(chunk)
                try:
                    check()
                except Refusal as reason:
                    remember(reason)
                    owner['expired'] = True
                if not chunk:
                    state['eof'] = True
                    unregister_error = None
                    try:
                        selector.unregister(stream)
                    except BaseException as reason:
                        unregister_error = reason
                        remember(reason)
                        raise
                    finally:
                        state['closeAttempted'] = True
                        try:
                            stream.close()
                            state['closeReturned'] = True
                        except BaseException as reason:
                            state['closeError'] = failure(reason)
                            remember(reason)
                            if unregister_error is None:
                                raise
                else:
                    count = 0 if owner['expired'] else min(len(chunk), 65536 - len(buffers[label]))
                    buffers[label].extend(chunk[:count])
                    state['retained'] += count
                    state['dropped'] = state['total'] - state['retained']
                    if state['dropped']:
                        remember(Refusal('QUERY_STREAM_CAP_OR_EXPIRED'))
        # No signal, timeout-as-reap, retry or fresh grace: actual wait only.
        owner['returncode'] = child.wait()
        owner['reaped'] = True
    except BaseException as reason:
        primary = reason
        owner['failure'] = failure(reason)
        remember(reason)
        raise
    finally:
        if custody['selector'] is not None:
            owner['selector']['closeAttempted'] = True
            try:
                custody['selector'].close()
                owner['selector']['closeReturned'] = True
            except BaseException as reason:
                cleanup_error = reason
                owner['selector']['closeError'] = failure(reason)
                remember(reason)
        if primary is None and cleanup_error is not None:
            raise cleanup_error
    assert not query_pending()
    check()
    assert not owner['expired'] and not any(owner[key]['dropped'] for key in buffers)
    owner['rows'] = parse_query(bytes(buffers['stdout']), owner['returncode'])
    owner['stderrText'] = bytes(buffers['stderr']).decode('utf-8', 'strict')
    return owner


def query_pending():
    if QUERY_CUSTODY is None:
        return False
    owner = QUERY_CUSTODY['record']
    return (owner['spawned'] and not owner['reaped'] or
            any(owner[label]['acquired'] and not owner[label]['closeReturned'] for label in ['stdout', 'stderr']) or
            owner['selector']['acquired'] and not owner['selector']['closeReturned'])


def join_python(record):
    expected = INVOCATION['python']
    assert set(expected) == {'candidate', 'status', 'canonical', 'physical', 'links', 'steps', 'pin'}
    assert expected['candidate'] == '/usr/bin/python3' and expected['status'] == 'OBSERVED'
    assert set(expected['pin']) == {'path', 'bytes', 'sha256', 'physical'}
    assert os.path.realpath(sys.executable) == expected['canonical'], 'RUNNING_PYTHON_CANONICAL_DRIFT'
    check()
    if record['status'] == 'DRIFT':
        return False
    assert record == expected, 'PREEXEC_PYTHON_OBSERVATION_DRIFT'
    return True


def main():
    global ROOT, INVOCATION, BODY_BYTES
    assert len(sys.argv) == 2 and sys.flags.isolated and sys.flags.no_site
    ROOT = sys.argv[1]
    assert isinstance(ROOT, str) and len(ROOT.encode('utf-8')) <= 1024
    assert re.fullmatch(re.escape(PARENT) + r'/wyreup-linux-intake-[0-9]{1,20}-[0-9]{1,20}', ROOT)
    assert os.path.realpath(ROOT) == ROOT == os.getcwd()
    current = '/'
    for part in ROOT.split('/')[1:]:
        current = os.path.join(current, part)
        assert not stat.S_ISLNK(os.lstat(current).st_mode)
    root_identity = identity(os.lstat(ROOT))
    assert stat.S_ISDIR(int(root_identity['mode'])) and int(root_identity['mode']) & 0o777 == 0o700
    assert int(root_identity['uid']) == os.getuid()
    invocation_pin, encoded = read_file(ROOT + '/invocation.json', 65536, 'invocation')
    INVOCATION = json.loads(encoded)
    assert set(INVOCATION) == {'schemaVersion', 'classification', 'source', 'python', 'root',
                               'startedAtMs', 'deadlineAtMs', 'startedMonotonicNs', 'deadlineMonotonicNs'}
    assert INVOCATION['schemaVersion'] == 1 and INVOCATION['classification'] == 'ROOT_OWNED_LINUX_INTAKE_INVOCATION'
    assert INVOCATION['root'] == {'path': ROOT, 'physical': root_identity}
    assert INVOCATION['deadlineAtMs'] - INVOCATION['startedAtMs'] == 30000
    assert int(INVOCATION['deadlineMonotonicNs']) - int(INVOCATION['startedMonotonicNs']) == 30000000000
    clock = time.get_clock_info('monotonic')
    assert clock.monotonic and not clock.adjustable and clock.implementation == 'clock_gettime(CLOCK_MONOTONIC)'
    check()
    source_pin, _ = read_file(os.path.realpath(__file__), 65536, 'collector-source', True)
    assert {key: source_pin[key] for key in ['path', 'bytes', 'sha256']} == INVOCATION['source']
    BODY_BYTES += INVOCATION['python']['pin']['bytes']
    image_bytes = bytearray()
    while True:
        check()
        chunk = os.read(0, 1025 - len(image_bytes))
        image_bytes.extend(chunk)
        check()
        assert len(image_bytes) <= 1024
        if not chunk:
            break
    image = json.loads(image_bytes)
    assert set(image) == {'ImageOS', 'ImageVersion'}
    assert all(value is None or isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9._-]{1,128}', value) for value in image.values())
    observations = {}
    for role, paths in ROLES.items():
        observations[role] = [observe(role, path) for path in paths]
        groups = {(record['physical']['dev'], record['physical']['ino']) for record in observations[role] if record['status'] == 'OBSERVED'}
        if len(groups) > 1 or any(record['status'] in ['HELD', 'DRIFT'] for record in observations[role]):
            for record in observations[role]:
                if record['status'] == 'OBSERVED':
                    record.update(status='HELD', reason='DISTINCT_PHYSICAL_ROLE_TARGETS' if len(groups) > 1 else 'HELD_ROLE_CANDIDATE')
        else:
            for index, record in enumerate(observations[role]):
                if record['status'] == 'OBSERVED':
                    read_observation(role, record)
                    if record['status'] in ['HELD', 'DRIFT']:
                        for later in observations[role][index + 1:]:
                            if later['status'] == 'OBSERVED':
                                later.update(status='HELD', reason='HELD_ROLE_CANDIDATE')
                        break
    join_python(observations['python'][0])
    query = None
    if observations['dpkgQuery'][0]['status'] == 'OBSERVED':
        query = package_query()
    uname = os.uname()
    resources = {}
    calls = {'cpuCount': os.cpu_count, 'affinityCount': lambda: len(os.sched_getaffinity(0)),
             'physicalPages': lambda: os.sysconf('SC_PHYS_PAGES'), 'availablePages': lambda: os.sysconf('SC_AVPHYS_PAGES'),
             'pageSize': lambda: os.sysconf('SC_PAGE_SIZE'), 'realUid': os.getuid, 'effectiveUid': os.geteuid}
    for key, call in calls.items():
        check()
        try:
            value = call()
            assert type(value) is int and value >= 0
            resources[key] = {'value': value}
        except (OSError, ValueError, AssertionError, AttributeError) as reason:
            resources[key] = {'unavailable': failure(reason)}
        check()
    filesystem = os.statvfs(ROOT)
    resources['filesystem'] = {key: getattr(filesystem, key) for key in ['f_frsize', 'f_blocks', 'f_bfree', 'f_bavail']}
    for key in ['physicalPages', 'availablePages']:
        resources[key + 'Bytes'] = resources[key].get('value', -1) * resources['pageSize'].get('value', -1) if 'value' in resources[key] and 'value' in resources['pageSize'] else None
    for key in ['f_blocks', 'f_bfree', 'f_bavail']:
        resources['filesystem'][key + 'Bytes'] = filesystem.f_frsize * getattr(filesystem, key)
    for role, records in observations.items():
        for record in records:
            if record['status'] == 'OBSERVED':
                if not revalidate_candidate(record):
                    continue
                if 'pin' in record and not any(candidate['status'] in ['HELD', 'DRIFT'] for candidate in records):
                    try:
                        again, _ = read_file(record['canonical'], 65536 if role in TEXT else 67108864, 'postguard:' + role,
                                             True, expected_physical=record['physical'])
                    except CandidateDrift:
                        record.update(status='DRIFT', reason='BODY_IDENTITY_DRIFT')
                        if PENDING_FDS:
                            raise
                        continue
                    if again != record['pin']:
                        record.update(status='DRIFT', reason='BODY_DRIFT')
    join_python(observations['python'][0])
    assert identity(os.lstat(ROOT)) == root_identity
    reloaded, _ = read_file(ROOT + '/invocation.json', 65536, 'invocation-postguard', True)
    assert reloaded == invocation_pin
    assert not PENDING_FDS and not query_pending()
    check()
    held = any(record['status'] in ['HELD', 'DRIFT'] for records in observations.values() for record in records)
    held |= query is not None and query['returncode'] == 1 and all(row['status'] == 'installed' for row in query['rows'].values())
    unavailable = any(not any(record['status'] == 'OBSERVED' for record in records) for records in observations.values())
    unavailable |= query is None or query['returncode'] != 0 or any(row['status'] != 'installed' for row in query['rows'].values())
    unavailable |= any('unavailable' in record for record in resources.values() if isinstance(record, dict))
    status = 'INCOMPLETE_CLOSED' if held or FIRST else 'COMPLETE_UNAVAILABLE' if unavailable else 'COMPLETE_USABLE'
    result = {'schemaVersion': 1, 'classification': 'READ_ONLY_LINUX_INTAKE_NOT_QUALIFICATION', 'status': status,
              'invocationPin': invocation_pin, 'source': source_pin, 'imageContext': image,
              'kernel': {key: getattr(uname, key) for key in ['sysname', 'release', 'version', 'machine']},
              'python': {'version': list(sys.version_info[:3]), 'executable': sys.executable, 'clockImplementation': clock.implementation},
              'observations': observations, 'packageQuery': query, 'resources': resources,
              'bodyReadBytes': BODY_BYTES, 'fileRecords': FD_RECORDS,
              'firstFailure': failure(FIRST[0]) if FIRST else None, 'secondary': [failure(reason) for reason in SECONDARY],
              'expired': EXPIRED, 'pendingFileDescriptors': list(PENDING_FDS),
              'writerClosure': 'PRETERMINAL_ROOT_PARENT_MUST_OBSERVE_ACTUAL_EXIT_PIPES_AND_REOPEN'}
    encoded = (json.dumps(result, separators=(',', ':')) + '\n').encode('utf-8')
    assert len(encoded) <= 65536
    check()
    offset = 0
    while offset < len(encoded):
        check()
        written = os.write(1, encoded[offset:])
        assert written > 0
        offset += written
        check()
    return 0 if status == 'COMPLETE_USABLE' else 1


if __name__ == '__main__':
    code = 1
    try:
        code = main()
    except BaseException as reason:
        remember(reason)
        # Fixed diagnostic only; never leak selected image-invalid values.
        if not EXPIRED:
            os.write(2, b'LINUX_INTAKE_INCOMPLETE_OR_UNAVAILABLE\n')
    finally:
        if PENDING_FDS or query_pending():
            # Actual uncertain owned descriptors stay retained; no fabricated
            # closure, signal or deadline extension permits dependent work.
            while PENDING_FDS or query_pending():
                time.sleep(3600)
    raise SystemExit(code)
