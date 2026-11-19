-- The MTN eKash entry code (*182*1*2#) is the most useful code in the directory:
-- from it a person can send money to bank accounts and to Mobile Money wallets
-- over the eKash interoperable network. It was seeded (phase P) as one of many
-- "<institution> - eKash transfer" rows with a bare description, so it sat among
-- the banks and did not say what it is for. Give it a name and description that
-- do. Content only: the code, provider, source and state are unchanged, and a
-- missing row (a database without the phase P seed) makes this a no-op.

update public.service_codes
set display_name_en = 'eKash - send money to a bank account or Mobile Money wallet',
    description_en  = 'Opens the eKash transfer menu on MTN. eKash is the interoperable payment network that links banks and Mobile Money wallets, so from here you can send money to a bank account or to a Mobile Money wallet. You choose the amount and where it goes, and you approve it with your own PIN on your phone - OneLedger never sees it.'
where slug = 'ekash-mtn-rwanda';
