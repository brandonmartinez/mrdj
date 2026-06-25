#!/bin/bash
# init-mrdj-db.sh — provision the mrdj database on the shared cluster PostgreSQL (story #45).
#
# Intended to be mounted into the cluster's shared-database `postgres-init` ConfigMap (data
# namespace) so it runs on Postgres startup, alongside the other apps' init scripts. Idempotent:
# safe to run repeatedly. Creates the `mrdj` role and `mrdj` database only if they don't exist.
#
# Per O5 (docs/decisions/manifests-location.md) the canonical copy of this script lives in the
# cluster GitOps repo; this file is the authoring source, promoted via a cluster-repo PR.
#
# Environment (provided by the Postgres container's init context):
#   POSTGRES_USER  — superuser used to run this script (e.g. the cluster admin role)
#   POSTGRES_DB    — maintenance database to connect to (e.g. "postgres")
#   MRDJ_DB_PASSWORD — password to assign to the mrdj role (inject via secret; falls back to a
#                      placeholder only so a misconfigured run fails loudly rather than silently)
set -euo pipefail

MRDJ_DB="${MRDJ_DB:-mrdj}"
MRDJ_ROLE="${MRDJ_ROLE:-mrdj}"
MRDJ_DB_PASSWORD="${MRDJ_DB_PASSWORD:-}"

if [[ -z "${MRDJ_DB_PASSWORD}" ]]; then
  echo "[init-mrdj-db] ERROR: MRDJ_DB_PASSWORD is not set; refusing to create a passwordless role." >&2
  exit 1
fi

echo "[init-mrdj-db] Ensuring role '${MRDJ_ROLE}' and database '${MRDJ_DB}' exist…"

# Create the role if absent. CREATE ROLE has no IF NOT EXISTS, so guard with a DO block.
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
	DO \$\$
	BEGIN
	  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MRDJ_ROLE}') THEN
	    CREATE ROLE ${MRDJ_ROLE} LOGIN PASSWORD '${MRDJ_DB_PASSWORD}';
	  ELSE
	    ALTER ROLE ${MRDJ_ROLE} WITH LOGIN PASSWORD '${MRDJ_DB_PASSWORD}';
	  END IF;
	END
	\$\$;
EOSQL

# Create the database if absent. CREATE DATABASE can't run inside a DO block / transaction, so
# gate it from the shell using a SELECT that prints 1 when the DB already exists.
if [[ "$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${MRDJ_DB}'" \
          --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}")" != "1" ]]; then
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
    -c "CREATE DATABASE ${MRDJ_DB} OWNER ${MRDJ_ROLE};"
  echo "[init-mrdj-db] Created database '${MRDJ_DB}'."
else
  echo "[init-mrdj-db] Database '${MRDJ_DB}' already exists; leaving as-is."
fi

# Ensure ownership/privileges even if the DB pre-existed.
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "GRANT ALL PRIVILEGES ON DATABASE ${MRDJ_DB} TO ${MRDJ_ROLE};"

echo "[init-mrdj-db] mrdj database initialization complete."
