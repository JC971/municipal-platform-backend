CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table des délibérations
CREATE TABLE deliberations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    titre           VARCHAR(255) NOT NULL,
    description     TEXT         NOT NULL,
    date            DATE         NOT NULL,
    statut          VARCHAR(50)  NOT NULL,      -- 'brouillon' / 'publié'
    thematique      VARCHAR(100),

    fichier_pdf_url TEXT,

    --created_by      UUID REFERENCES users(id),-- Optionnel, si vous souhaitez lier à un utilisateur
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP
);

-- Index pour les filtres du contrôleur
CREATE INDEX idx_deliberations_date       ON deliberations(date);
CREATE INDEX idx_deliberations_statut     ON deliberations(statut);
CREATE INDEX idx_deliberations_thematique ON deliberations(thematique);