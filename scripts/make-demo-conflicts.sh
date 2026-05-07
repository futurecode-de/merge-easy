#!/usr/bin/env bash
#
# make-demo-conflicts.sh
#
# Creates a throwaway git repo with five small PHP files, two of which
# end up in a merge-conflict state. Useful for exercising the Merge Easy
# sidebar and merge editor end-to-end.
#
# Usage:
#   ./scripts/make-demo-conflicts.sh                    # creates /tmp/merge-easy-demo
#   ./scripts/make-demo-conflicts.sh /tmp/my-other-dir  # custom target
#
# After it finishes, open the folder in VSCode (with the Merge Easy
# extension active) and click the Merge Easy icon in the activity bar.

set -euo pipefail

DIR="${1:-/tmp/merge-easy-demo}"

if [[ -e "$DIR" ]]; then
  echo "Wiping existing $DIR"
  rm -rf "$DIR"
fi

mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "demo@local"
git config user.name  "Merge Easy Demo"

# ─────────────────────────────────────────────────────────────────────
# Initial commit: 5 PHP files
# ─────────────────────────────────────────────────────────────────────

cat > User.php <<'PHP'
<?php

class User
{
    public string $name;
    public string $email;

    public function __construct(string $name, string $email)
    {
        $this->name  = $name;
        $this->email = $email;
    }
}
PHP

cat > Auth.php <<'PHP'
<?php

class Auth
{
    private const MIN_PASSWORD = 6;

    public function login(string $username, string $password): bool
    {
        if (strlen($password) < self::MIN_PASSWORD) {
            return false;
        }
        return $this->verify($username, $password);
    }

    private function verify(string $u, string $p): bool
    {
        return $u === 'admin' && $p === 'secret';
    }
}
PHP

cat > Database.php <<'PHP'
<?php

class Database
{
    private \PDO $pdo;

    public function __construct(string $dsn)
    {
        $this->pdo = new \PDO($dsn);
    }

    public function query(string $sql): array
    {
        return $this->pdo->query($sql)->fetchAll();
    }
}
PHP

cat > Logger.php <<'PHP'
<?php

class Logger
{
    private const PREFIX = 'app';

    public function info(string $msg): void
    {
        echo '[' . self::PREFIX . '][INFO] ' . $msg . "\n";
    }

    public function error(string $msg): void
    {
        echo '[' . self::PREFIX . '][ERROR] ' . $msg . "\n";
    }
}
PHP

cat > index.php <<'PHP'
<?php

require_once __DIR__ . '/User.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';

$logger = new Logger();
$logger->info('App started');
PHP

git add -A
git commit -q -m "initial scaffolding"

INITIAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# ─────────────────────────────────────────────────────────────────────
# Branch "feature": touches Auth.php, Logger.php (will conflict) plus
# User.php (will NOT conflict — different region than main's change).
# ─────────────────────────────────────────────────────────────────────

git checkout -q -b feature

# Auth.php: tighten password rules and switch to password_verify.
cat > Auth.php <<'PHP'
<?php

class Auth
{
    private const MIN_PASSWORD = 10;

    public function login(string $username, string $password): bool
    {
        if (strlen($password) < self::MIN_PASSWORD) {
            return false;
        }
        return $this->verify($username, $password);
    }

    private function verify(string $u, string $p): bool
    {
        return password_verify($p, $this->hashFor($u));
    }

    private function hashFor(string $u): string
    {
        return $_SERVER['USERS'][$u] ?? '';
    }
}
PHP

# Logger.php: route through syslog.
cat > Logger.php <<'PHP'
<?php

class Logger
{
    private const PREFIX = 'merge-easy';

    public function __construct()
    {
        openlog(self::PREFIX, LOG_PID, LOG_USER);
    }

    public function info(string $msg): void
    {
        syslog(LOG_INFO, $msg);
    }

    public function error(string $msg): void
    {
        syslog(LOG_ERR, $msg);
    }
}
PHP

# User.php: add an avatar field — won't conflict because main edits Database.
cat > User.php <<'PHP'
<?php

class User
{
    public string $name;
    public string $email;
    public ?string $avatar = null;

    public function __construct(string $name, string $email, ?string $avatar = null)
    {
        $this->name   = $name;
        $this->email  = $email;
        $this->avatar = $avatar;
    }
}
PHP

git add -A
git commit -q -m "feature: stricter auth, syslog logger, avatar field"

# ─────────────────────────────────────────────────────────────────────
# Back to the initial branch: conflicting changes to Auth.php and
# Logger.php, plus a non-conflicting change to Database.php.
# ─────────────────────────────────────────────────────────────────────

git checkout -q "$INITIAL_BRANCH"

# Auth.php: per-user minimum length and a constant-time string compare.
cat > Auth.php <<'PHP'
<?php

class Auth
{
    private const MIN_PASSWORD = 12;

    public function login(string $username, string $password): bool
    {
        if (strlen($password) < $this->minLengthFor($username)) {
            return false;
        }
        return $this->verify($username, $password);
    }

    private function minLengthFor(string $u): int
    {
        return $u === 'admin' ? 16 : self::MIN_PASSWORD;
    }

    private function verify(string $u, string $p): bool
    {
        return hash_equals($this->knownHash($u), hash('sha256', $p));
    }

    private function knownHash(string $u): string
    {
        return $_SERVER['HASHES'][$u] ?? '';
    }
}
PHP

# Logger.php: write to a rolling file instead of stdout.
cat > Logger.php <<'PHP'
<?php

class Logger
{
    private const PREFIX = 'app';

    private string $path;

    public function __construct(string $path = '/var/log/app.log')
    {
        $this->path = $path;
    }

    public function info(string $msg): void
    {
        file_put_contents($this->path, '[' . self::PREFIX . '][INFO] ' . $msg . "\n", FILE_APPEND);
    }

    public function error(string $msg): void
    {
        file_put_contents($this->path, '[' . self::PREFIX . '][ERROR] ' . $msg . "\n", FILE_APPEND);
    }
}
PHP

# Database.php: enable strict PDO error mode — non-conflicting change.
cat > Database.php <<'PHP'
<?php

class Database
{
    private \PDO $pdo;

    public function __construct(string $dsn)
    {
        $this->pdo = new \PDO($dsn);
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    }

    public function query(string $sql): array
    {
        return $this->pdo->query($sql)->fetchAll();
    }
}
PHP

git add -A
git commit -q -m "main: per-user min length, file logger, strict PDO"

# ─────────────────────────────────────────────────────────────────────
# Trigger the merge — expected to fail on Auth.php and Logger.php.
# ─────────────────────────────────────────────────────────────────────

echo
echo "Merging 'feature' into '$INITIAL_BRANCH' — expecting conflicts..."
if git merge feature --no-edit >/dev/null 2>&1; then
  echo "Unexpected: merge succeeded with no conflicts."
  exit 1
fi

echo
echo "Repo ready at: $DIR"
echo
echo "Status:"
git status --short
echo
echo "Open in VSCode:"
echo "  code \"$DIR\""
echo
echo "Then click the Merge Easy icon in the activity bar — Auth.php and"
echo "Logger.php should appear with a conflict count."
