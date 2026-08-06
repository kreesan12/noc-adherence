# Database Access

## Production Database

- Host server:
  - `noc-api-01`
- Public IP:
  - `154.65.108.106`
- PostgreSQL host on the server:
  - `127.0.0.1`
- PostgreSQL port:
  - `5432`
- Database:
  - `noc_adherence`
- Application username:
  - `noc_app`

## Recommended DBeaver Setup

Use DBeaver with an SSH tunnel rather than exposing PostgreSQL directly to the internet.

### SSH Tab

- Host:
  - `154.65.108.106`
- User:
  - `ubuntu`
- Authentication:
  - public key
- Private key:
  - your xneelo PEM key

### PostgreSQL Tab

- Host:
  - `127.0.0.1`
- Port:
  - `5432`
- Database:
  - `noc_adherence`
- Username:
  - `noc_app`
- Password:
  - use the current production password from the server env or secure password vault

### SSL

- not required when you are tunneling through SSH

## Useful Server Commands

### Check Database Size

```bash
sudo -u postgres psql -d noc_adherence -c "select pg_size_pretty(pg_database_size('noc_adherence'));"
```

### Check Active Connections

```bash
sudo -u postgres psql -c "select count(*) from pg_stat_activity;"
```

### Check Nightly Backups

```bash
ls -lh /srv/postgresql/backups/nightly
```
