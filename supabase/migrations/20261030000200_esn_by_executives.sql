-- ============================================================
-- MESA Events Platform – ESN Activities is the executive board's job
-- (round 2026-10-30)
--
-- Uploading events to ESN Activities moves from the Comms team to the
-- executive board, so Comms has less to do: executives mark events
-- uploaded (or take a wrong link back) and create the personal access
-- tokens the browser script uses; a token works while its owner is an
-- executive. Everyone who could read the status still can.
-- ============================================================

create or replace function public.mark_esn_uploaded(event uuid, url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('executive') then
    raise exception 'Only the executive board marks events uploaded to ESN Activities' using errcode = '42501';
  end if;
  perform private.link_esn_activity(event, url, 'manual', public.auth_email());
end;
$$;

create or replace function public.unmark_esn_uploaded(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('executive') then
    raise exception 'Only the executive board changes the ESN Activities status' using errcode = '42501';
  end if;
  delete from public.esn_uploads where event_id = event;
end;
$$;

create or replace function public.create_esn_token(label text, valid_days integer default 180)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  id uuid;
begin
  if not public.has_role('executive') then
    raise exception 'Only the executive board uploads to ESN Activities' using errcode = '42501';
  end if;
  if valid_days not in (30, 90, 180, 365) then
    raise exception 'A token is valid for 30, 90, 180 or 365 days' using errcode = '22023';
  end if;
  if (select count(*) from public.esn_access_tokens t where t.profile_id = auth.uid() and t.revoked_at is null and t.expires_at > now()) >= 5 then
    raise exception 'You have 5 active tokens – revoke one first' using errcode = '22023';
  end if;
  token := 'mesa_esn_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.esn_access_tokens (profile_id, label, token_hash, token_prefix, expires_at)
  values (auth.uid(), trim(label), encode(extensions.digest(token, 'sha256'), 'hex'), left(token, 13), now() + make_interval(days => valid_days))
  returning esn_access_tokens.id into id;
  perform private.log('esn_access_tokens', id::text, 'insert', null, null,
    jsonb_build_object('label', trim(label), 'token_prefix', left(token, 13), 'valid_days', valid_days));
  return token;
end;
$$;

-- The API: a token is valid while its owner is on the executive board.
create or replace function public.esn_token_owner(hash text)
returns table (token_id uuid, profile_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.esn_access_tokens t set last_used_at = now()
    from public.profiles p
    where t.token_hash = hash and p.id = t.profile_id
      and t.revoked_at is null and t.expires_at > now()
      and exists (select 1 from public.role_members r where r.email = p.email and r.role = 'executive')
    returning t.id, t.profile_id, p.email;
end;
$$;
