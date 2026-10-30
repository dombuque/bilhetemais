-- Notificações por zona: posição aproximada (arredondada a ~1 km) de cada aparelho, para avisar de novos eventos num raio de 150 km.
ALTER TABLE push_subscriptions ADD COLUMN lat double precision, ADD COLUMN lng double precision, ADD COLUMN located_at timestamptz;
