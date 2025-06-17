ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE,
    ADD COLUMN IF NOT EXISTS email    VARCHAR(255) UNIQUE,
    ADD COLUMN IF NOT EXISTS role     VARCHAR(50)  DEFAULT 'agent';

-- (facultatif) pré-remplir username pour les comptes déjà présents
UPDATE users
SET    username = COALESCE(username, split_part(email,'@',1))
WHERE  username IS NULL;

-- (facultatif) index dédié
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);