-- Localização dos eventos no mapa.
ALTER TABLE events
  ADD COLUMN latitude numeric(9,6),
  ADD COLUMN longitude numeric(9,6),
  ADD CONSTRAINT events_geo_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT events_geo_range CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
