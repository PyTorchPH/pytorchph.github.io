-- New accounts no longer wait for officer approval (Google sign-in now matches email signup),
-- so accounts left pending under the old rule become members.
UPDATE members SET role = 'member' WHERE role = 'pending';
