CREATE TABLE public_api_rate_windows (
  route TEXT NOT NULL CHECK (route = 'domain-age'),
  window_start INTEGER NOT NULL CHECK (typeof(window_start) = 'integer' AND window_start >= 0 AND window_start % 60 = 0),
  scope_key TEXT NOT NULL CHECK (scope_key = 'global' OR (length(scope_key) = 64 AND scope_key NOT GLOB '*[^0-9a-f]*')),
  count INTEGER NOT NULL CHECK (typeof(count) = 'integer' AND count >= 1 AND count <= CASE WHEN scope_key = 'global' THEN 60 ELSE 6 END),
  PRIMARY KEY (route, window_start, scope_key)
);
CREATE TABLE public_api_inflight_leases (
  route TEXT NOT NULL CHECK (route = 'domain-age'),
  token TEXT NOT NULL CHECK (length(token) = 32 AND token NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at = created_at + 30),
  PRIMARY KEY (route, token)
);
CREATE INDEX public_api_lease_expiry ON public_api_inflight_leases(expires_at);
CREATE TRIGGER public_api_window_insert BEFORE INSERT ON public_api_rate_windows
WHEN NEW.window_start != (unixepoch() / 60) * 60
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_WINDOW_CHANGED'); END;
CREATE TRIGGER public_api_window_update BEFORE UPDATE ON public_api_rate_windows
WHEN NEW.window_start != (unixepoch() / 60) * 60
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_WINDOW_CHANGED'); END;
CREATE TRIGGER public_api_global_full BEFORE UPDATE ON public_api_rate_windows
WHEN NEW.scope_key = 'global' AND NEW.count > 60
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_GLOBAL_LIMIT'); END;
CREATE TRIGGER public_api_network_full BEFORE UPDATE ON public_api_rate_windows
WHEN NEW.scope_key != 'global' AND NEW.count > 6
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_NETWORK_LIMIT'); END;
CREATE TRIGGER public_api_lease_full BEFORE INSERT ON public_api_inflight_leases
WHEN (SELECT COUNT(*) FROM public_api_inflight_leases) >= 8
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_INFLIGHT_LIMIT'); END;
CREATE TRIGGER public_api_lease_clock BEFORE INSERT ON public_api_inflight_leases
WHEN NEW.created_at != unixepoch() OR NEW.expires_at != unixepoch() + 30
BEGIN SELECT RAISE(ABORT, 'DOMAIN_AGE_LEASE_CLOCK'); END;
