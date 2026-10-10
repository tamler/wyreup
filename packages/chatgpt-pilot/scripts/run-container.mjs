import { spawn } from 'node:child_process';
import { configuredOutputOrigins } from './output-delivery.mjs';

const image = process.env.WYREUP_CHATGPT_IMAGE;
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
  process.stderr.write('Set WYREUP_CHATGPT_IMAGE to the reviewed immutable local Docker image ID.\n');
  process.exit(1);
}
const hosts = process.env.WYREUP_CHATGPT_DOWNLOAD_HOSTS ?? '';
let outputOrigins;
try { outputOrigins = configuredOutputOrigins(process.env.WYREUP_CHATGPT_OUTPUT_ORIGINS).join(','); }
catch {
  process.stderr.write('Output origins must be exact lowercase HTTPS DNS origins separated by commas.\n');
  process.exit(1);
}
if (hosts.length > 4096 || (hosts !== '' && hosts.split(',').some(host => host.length > 253
  || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)))) {
  process.stderr.write('Download hosts must be exact lowercase DNS names separated by commas.\n');
  process.exit(1);
}
const docker = spawn('docker', [
  'run', '--rm', '-i', '--read-only', '--memory=1g', '--memory-swap=1g',
  '--cpus=2', '--pids-limit=64', '--cap-drop=ALL', '--security-opt=no-new-privileges',
  '--user=1000:1000', '--network=bridge', '--log-driver=none',
  '--env', 'WYREUP_CHATGPT_DOWNLOAD_HOSTS=' + hosts,
  '--env', 'WYREUP_CHATGPT_OUTPUT_ORIGINS=' + outputOrigins, image,
], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
    ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {}) },
});
let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  process.stdin.unpipe(docker.stdin);
  docker.stdin.end();
  docker.kill(signal);
}
process.stdin.pipe(docker.stdin);
process.stdin.once('end', () => stop());
process.stdin.once('close', () => stop());
docker.stdin.on('error', () => stop());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
docker.on('error', () => { process.stderr.write('Unable to start the bounded Docker runtime.\n'); process.exitCode = 1; });
docker.on('exit', (code, signal) => {
  process.stdin.unpipe(docker.stdin);
  process.stdin.pause();
  process.exitCode = code ?? (signal ? 1 : 0);
});
