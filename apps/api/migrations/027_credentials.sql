-- Credenciais (staff, fornecedores, imprensa, convidados): bilhetes a custo zero emitidos pelo organizador.
-- Ficam em tipos próprios (quantity 0: não contam para a lotação nem aparecem à venda).
ALTER TABLE ticket_types ADD COLUMN credential boolean NOT NULL DEFAULT false;
ALTER TABLE ticket_types DROP CONSTRAINT ticket_types_quantity_check;
ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_quantity_check CHECK (quantity > 0 OR credential);
