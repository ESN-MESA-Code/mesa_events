-- ============================================================
-- MESA Events Platform – the event's address, as ESN Activities wants it
-- (user request 2026-10-29, after brief B)
--
-- The OC (or the Events team) enters country, street address, postal code
-- and city on the event; `location` stays the venue's name ("Shamrock").
-- The form checks the postal code's format and fills in the city
-- (lib/address.ts); the database keeps the shapes honest: an ISO country
-- code, a German postal code of five digits, a house number in the street.
-- Who may change them is unchanged (the event guard lets the OC change
-- the place, as before).
-- ============================================================

alter table public.events
  add column address_country text not null default 'DE' constraint events_address_country_check check (address_country ~ '^[A-Z]{2}$'),
  add column address_street text constraint events_address_street_check check (address_street is null or (length(address_street) between 3 and 200 and address_street ~ '[0-9]')),
  add column address_postal_code text constraint events_address_postal_check check (address_postal_code is null or length(address_postal_code) between 3 and 10),
  add column address_city text constraint events_address_city_check check (address_city is null or length(address_city) between 1 and 100),
  add constraint events_address_de_postal_check check (address_country <> 'DE' or address_postal_code is null or address_postal_code ~ '^[0-9]{5}$');
