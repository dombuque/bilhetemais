-- Entrada e saída: cada bilhete sabe se está dentro do recinto; cada leitura guarda o sentido (IN/OUT).
ALTER TABLE tickets ADD COLUMN inside boolean NOT NULL DEFAULT false;
UPDATE tickets SET inside = true WHERE status = 'USED'; -- quem já tinha entrado conta como dentro até haver leitura de saída
ALTER TABLE entry_scans ADD COLUMN direction text NOT NULL DEFAULT 'IN' CHECK (direction IN ('IN','OUT'));
