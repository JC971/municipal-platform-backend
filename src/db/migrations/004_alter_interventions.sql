-- 004_alter_interventions.sql
ALTER TABLE interventions
  ADD COLUMN IF NOT EXISTS statut        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS priorite      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS type          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS date_creation TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS date_fin      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS latitude      DECIMAL(10,8),
  ADD COLUMN IF NOT EXISTS longitude     DECIMAL(11,8);

-- Index désormais possibles
CREATE INDEX IF NOT EXISTS idx_interventions_statut   ON interventions(statut);
CREATE INDEX IF NOT EXISTS idx_interventions_priorite ON interventions(priorite);
CREATE INDEX IF NOT EXISTS idx_interventions_type     ON interventions(type);
CREATE INDEX IF NOT EXISTS idx_interventions_dates    ON interventions(date_creation, date_fin);
CREATE INDEX IF NOT EXISTS idx_interventions_geoloc   ON interventions(latitude, longitude);

