-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1️⃣  Table users (minimaliste)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE,
  password TEXT
);

-- 2️⃣  Table interventions (simplifiée)
CREATE TABLE IF NOT EXISTS interventions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titre VARCHAR(255),
  description TEXT
);

-- 3️⃣  Table deliberations (déjà créée par 002, garde IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS deliberations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titre VARCHAR(255)
);

CREATE TABLE annexes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deliberation_id UUID NOT NULL REFERENCES deliberations(id) ON DELETE CASCADE,
    nom VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,

    type VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des commissions
CREATE TABLE commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nom VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);

-- Table des membres des commissions
CREATE TABLE membres_commission (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    commission_id UUID NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    fonction VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des réunions de commission
CREATE TABLE reunions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    commission_id UUID NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
    date TIMESTAMP NOT NULL,
    lieu VARCHAR(255),
    statut VARCHAR(50) NOT NULL,
    ordre_du_jour TEXT,
    compte_rendu TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);

-- Table des présences aux réunions
CREATE TABLE presences (
    reunion_id UUID NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
    membre_id UUID NOT NULL REFERENCES membres_commission(id) ON DELETE CASCADE,
    statut VARCHAR(50) NOT NULL, -- 'présent', 'excusé', 'absent'
    PRIMARY KEY (reunion_id, membre_id)
);

-- Table des documents de réunion
CREATE TABLE documents_reunion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reunion_id UUID NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
    titre VARCHAR(255) NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des actions de suivi
CREATE TABLE actions_suivi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reunion_id UUID NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    echeance DATE,
    statut VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);

-- Table des responsables d'action
CREATE TABLE responsables_action (
    action_id UUID NOT NULL REFERENCES actions_suivi(id) ON DELETE CASCADE,
    membre_id UUID NOT NULL REFERENCES membres_commission(id) ON DELETE CASCADE,
    PRIMARY KEY (action_id, membre_id)
);

-- Table des interventions
CREATE TABLE interventions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    titre VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    type VARCHAR(100) NOT NULL,
    adresse TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    statut VARCHAR(50) NOT NULL,
    priorite VARCHAR(50) NOT NULL,
    date_creation TIMESTAMP NOT NULL DEFAULT NOW(),
    date_planification TIMESTAMP,
    date_debut TIMESTAMP,
    date_fin TIMESTAMP,
    date_validation TIMESTAMP,
    cout_estime DECIMAL(10, 2),
    cout_final DECIMAL(10, 2),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);

-- Table des équipes assignées aux interventions
CREATE TABLE equipes_intervention (
    intervention_id UUID NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (intervention_id, agent_id)
);

-- Table des documents d'intervention
CREATE TABLE documents_intervention (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intervention_id UUID NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    nom VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    date_ajout TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des commentaires d'intervention
CREATE TABLE commentaires_intervention (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intervention_id UUID NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    texte TEXT NOT NULL,
    auteur_id UUID NOT NULL REFERENCES users(id),
    date TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des enregistrements blockchain pour interventions
CREATE TABLE blockchain_interventions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intervention_id UUID NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    transaction_hash VARCHAR(255) NOT NULL,
    block_number BIGINT NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des doléances
CREATE TABLE doleances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    numero_suivi VARCHAR(50) NOT NULL UNIQUE,
    titre VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    date_creation TIMESTAMP NOT NULL DEFAULT NOW(),
    statut VARCHAR(50) NOT NULL,
    urgence VARCHAR(50),
    categorie VARCHAR(100),
    adresse TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    citoyen_anonyme BOOLEAN NOT NULL DEFAULT FALSE,
    citoyen_nom VARCHAR(255),
    citoyen_email VARCHAR(255),
    citoyen_telephone VARCHAR(50),
    citoyen_id UUID,
    intervention_liee_id UUID REFERENCES interventions(id),
    date_resolution TIMESTAMP,
    cout_resolution DECIMAL(10, 2),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP
);
    -- Table des photos de doléances
CREATE TABLE photos_doleance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table de l'historique des doléances
CREATE TABLE historique_doleance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    statut VARCHAR(50) NOT NULL,
    commentaire TEXT,
    agent_id UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table des agents assignés aux doléances
CREATE TABLE agents_doleance (
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (doleance_id, agent_id)
);

-- Table des commentaires internes sur doléances
CREATE TABLE commentaires_doleance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    texte TEXT NOT NULL,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    agent_id UUID NOT NULL REFERENCES users(id)
);

-- Table des réponses publiques aux doléances
CREATE TABLE reponses_publiques (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    texte TEXT NOT NULL,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    agent_id UUID NOT NULL REFERENCES users(id)
);

-- Table des enregistrements blockchain pour doléances
CREATE TABLE blockchain_doleances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doleance_id UUID NOT NULL REFERENCES doleances(id) ON DELETE CASCADE,
    transaction_hash VARCHAR(255) NOT NULL,
    block_number BIGINT NOT NULL,
    timestamp BIGINT NOT NULL,
    hash_description VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Création des index pour améliorer les performances

-- Index sur les délibérations
CREATE INDEX idx_deliberations_date ON deliberations(date);
CREATE INDEX idx_deliberations_statut ON deliberations(statut);
CREATE INDEX idx_deliberations_thematique ON deliberations(thematique);

-- Index sur les commissions
CREATE INDEX idx_commissions_type ON commissions(type);

-- Index sur les réunions
CREATE INDEX idx_reunions_commission_id ON reunions(commission_id);
CREATE INDEX idx_reunions_date ON reunions(date);
CREATE INDEX idx_reunions_statut ON reunions(statut);

-- Index sur les interventions
CREATE INDEX idx_interventions_statut ON interventions(statut);
CREATE INDEX idx_interventions_priorite ON interventions(priorite);
CREATE INDEX idx_interventions_type ON interventions(type);
CREATE INDEX idx_interventions_dates ON interventions(date_creation, date_fin);
CREATE INDEX idx_interventions_geoloc ON interventions(latitude, longitude);

-- Index sur les doléances
CREATE INDEX idx_doleances_statut ON doleances(statut);
CREATE INDEX idx_doleances_categorie ON doleances(categorie);
CREATE INDEX idx_doleances_urgence ON doleances(urgence);
CREATE INDEX idx_doleances_dates ON doleances(date_creation, date_resolution);
CREATE INDEX idx_doleances_geoloc ON doleances(latitude, longitude);
CREATE INDEX idx_doleances_citoyen ON doleances(citoyen_id);

-- Création de fonctions et triggers pour la gestion automatique

-- Fonction pour mettre à jour la date de modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;

$$ LANGUAGE plpgsql;

-- Triggers pour mettre à jour automatiquement les dates de modification
CREATE TRIGGER update_users_updated_at BEFORE UPDATE
ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_deliberations_updated_at BEFORE UPDATE
ON deliberations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_commissions_updated_at BEFORE UPDATE
ON commissions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_reunions_updated_at BEFORE UPDATE
ON reunions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_actions_suivi_updated_at BEFORE UPDATE
ON actions_suivi FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_interventions_updated_at BEFORE UPDATE
ON interventions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_doleances_updated_at BEFORE UPDATE
ON doleances FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Fonction pour générer automatiquement un numéro de suivi pour les doléances
CREATE OR REPLACE FUNCTION generate_doleance_numero_suivi()
RETURNS TRIGGER AS $$
DECLARE
    year_part TEXT;
    seq_number INTEGER;
BEGIN
    -- Format: DOL-YYYY-XXXXX (ex: DOL-2023-00001)
    year_part := to_char(NEW.date_creation, 'YYYY');
    
    -- Obtenir le prochain numéro de séquence pour l'année
    SELECT COALESCE(MAX(SUBSTRING(numero_suivi FROM 10)::INTEGER), 0) + 1
    INTO seq_number
    FROM doleances
    WHERE SUBSTRING(numero_suivi FROM 5 FOR 4) = year_part;
    
    -- Générer le numéro de suivi
    NEW.numero_suivi := 'DOL-' || year_part || '-' || LPAD(seq_number::TEXT, 5, '0');
    
    RETURN NEW;
END;

$$ LANGUAGE plpgsql;

-- Trigger pour générer un numéro de suivi avant l'insertion d'une doléance
CREATE TRIGGER trg_generate_doleance_numero_suivi
BEFORE INSERT ON doleances
FOR EACH ROW
EXECUTE PROCEDURE generate_doleance_numero_suivi();