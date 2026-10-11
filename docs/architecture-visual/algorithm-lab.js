'use strict';

const api = 'website/backend/api/src/';
const identity = 'mail-server/services/identity-auth/src/';
const step = (label, value, note) => ({ label, value, note });
const select = (key, label, options, initial = options[0][0]) => ({ key, label, options, initial });
const range = (key, label, min, max, initial) => ({ key, label, min, max, initial });
const yesNo = [['yes', 'Oo'], ['no', 'Hindi']];
const model = (steps, outcome, artifact, stop = 5, denied = false) => ({ steps, outcome, artifact, stop, denied });

// Each lab describes one bounded source path. Inputs and records are synthetic.
const labs = [
  {
    id: 'session', group: 'ACCESS & TRUST', name: 'Session lookup', status: 'Implemented',
    purpose: 'Cookie → hash → database lookup → authenticated viewer.',
    sources: [[api + 'identity/session.rs:59', 'viewer → session_token → member_for_token'], [api + 'identity/session.rs:242', 'new_session_token · hash_token · is_well_formed_token']],
    fields: [select('token', 'Cookie', [['valid', 'Valid sample'], ['missing', 'Walang cookie'], ['malformed', 'Maling format']]), select('found', 'Nasa database?', yesNo), select('expired', 'Expired?', yesNo, 'no')],
    build(v) {
      const stop = v.token !== 'valid' ? 1 : v.found === 'no' || v.expired === 'yes' ? 3 : 5;
      return model([
        step('Browser cookie', v.token === 'missing' ? 'Walang ph_session cookie' : 'ph_session=sample…', 'HttpOnly ang cookie. Hindi kinukuha ng browser JavaScript ang tunay na token.'),
        step('Token format', v.token === 'valid' ? '64 hex characters ✓' : 'Missing / malformed ✕', 'Hinahanap ang ph_session; kailangang 64 ASCII hex characters ang token.'),
        step('SHA-256', 'token → 64-char hash', 'Hash ng token ang ginagamit sa query. Symbolic ang hash sa visual; walang totoong credential.'),
        step('Session + member JOIN', v.found === 'no' ? 'Walang matching row' : v.expired === 'yes' ? 'expires_at ≤ now' : 'hash match + unexpired ✓', 'Kailangang parehong tumugma ang token hash at expires_at > now bago maibalik ang member.'),
        step('Viewer', 'id · display_name · role', 'Ang role ay galing sa member row; hindi sa hostname o client input.'),
        step('Authenticated request', 'Viewer available ✓', 'Ito ang ordinary cookie path. May hiwalay na trusted replay path sa source.')
      ], stop < 5 ? '401 · DENIED' : 'VIEWER ✓', { kind: 'tokens', items: ['COOKIE', 'SHA-256', 'SESSION ROW', 'VIEWER'] }, stop, stop < 5);
    }
  },
  {
    id: 'rubric', group: 'EVIDENCE & RANKING', name: 'Weighted points', status: 'Implemented',
    purpose: 'Published rubric units × 10 × source weight.',
    sources: [[api + 'evidence/rubric.rs:25', 'rubric_points → weighted_points → source_weight']],
    fields: [range('units', 'Sample rubric units', 1, 12, 3), select('source', 'Evidence source', [['github', 'GitHub · ×2'], ['other', 'Iba pang source · ×3']]), select('published', 'May published rubric?', yesNo)],
    build(v) {
      const weight = v.source === 'github' ? 2 : 3;
      const total = Math.round(v.units * 10 * weight);
      return model([
        step('Verified level', 'Officer-selected level', 'Ang level ay participation, contributor, finalist_lead, o winner_top_award.'),
        step('Published rubric', v.published === 'yes' ? 'Newest published version ✓' : 'Walang rubric match', 'Pinipili ang pinakabagong published rubric para sa level. Sample units ang slider, hindi actual level mapping.'),
        step('Base units', `${v.units} units`, 'Sa tunay na request, sa database nanggagaling ang units; hindi sa user slider.'),
        step('Points per unit', `${v.units} × 10 = ${v.units * 10}`, 'Fixed sa source ang POINTS_PER_UNIT = 10.'),
        step('Source weight', `${v.units * 10} × ${weight}`, 'GitHub: 2.0. Lahat ng ibang source: 3.0.'),
        step('Rounded points', `${total} points`, 'round(units × 10 × weight). Kapag walang rubric row, walang point result ang lookup.')
      ], v.published === 'yes' ? `${total} POINTS` : 'NO RUBRIC', { kind: 'equation', items: [String(v.units), '× 10', `× ${weight}`, `= ${total}`] }, v.published === 'yes' ? 5 : 1, v.published !== 'yes');
    }
  },
  {
    id: 'review', group: 'EVIDENCE & RANKING', name: 'Review transaction', status: 'Implemented',
    purpose: 'Validate → pending claim → authorization → effects + audit → commit.',
    sources: [[api + 'evidence/review.rs:144', 'review_claim · ensure_may_decide · apply_decision']],
    fields: [select('decision', 'Decision', [['approve', 'Approve'], ['scraper_defect', 'Scraper defect'], ['reject_unsupported', 'Unsupported'], ['confirm_falsification', 'Falsification'], ['confirm_tampering', 'Tampering']]), select('origin', 'Claim origin', [['manual', 'Manual'], ['extension', 'Extension scrape']]), select('self', 'Sariling claim?', yesNo, 'no'), select('pending', 'Pending pa?', yesNo)],
    build(v) {
      const wrongOrigin = (['scraper_defect', 'confirm_tampering'].includes(v.decision) && v.origin !== 'extension') || (v.decision === 'confirm_falsification' && v.origin !== 'manual');
      const stop = v.pending === 'no' ? 2 : v.self === 'yes' || wrongOrigin ? 3 : 5;
      const effect = v.decision === 'approve' ? 'Approve + ledger + refresh job' : v.decision === 'scraper_defect' ? 'Keep pending · disputed review' : v.decision === 'reject_unsupported' ? 'Close claim' : 'Close claim + sanction';
      return model([
        step('Parse decision', v.decision, 'Sample request ay may valid level para sa approval at valid reason para sa ibang decisions.'),
        step('BEGIN transaction', 'Isang database transaction', 'Magkakasama ang effects at review record sa transaction.'),
        step('Load pending claim', v.pending === 'yes' ? 'status = pending ✓' : '409 · pending claim missing', 'Claim na pending lang ang puwedeng i-review.'),
        step('Reviewer + origin', v.self === 'yes' ? '403 · self-review denied' : wrongOrigin ? '400 · wrong claim origin' : 'Reviewer + origin ✓', 'Bawal ang sariling claim. Tampering/defect: extension lang. Falsification: manual lang.'),
        step('Apply + audit', effect, 'Approval awards rubric points; confirmed violations impose sanctions. Isinusulat din ang reviewer at decision.'),
        step('COMMIT', 'Effects + review saved ✓', 'Commit lang pagkatapos ng lahat. Sa error path, hindi kino-commit ang transaction.')
      ], stop === 5 ? (v.decision === 'scraper_defect' ? 'PENDING / DISPUTED' : 'COMMITTED ✓') : v.pending === 'no' ? '409 · CONFLICT' : v.self === 'yes' ? '403 · DENIED' : '400 · BAD ORIGIN', { kind: 'transaction', items: ['BEGIN', 'CLAIM', 'EFFECTS', 'AUDIT', 'COMMIT'] }, stop, stop < 5);
    }
  },
  {
    id: 'ranking', group: 'EVIDENCE & RANKING', name: 'Ranking tie-breakers', status: 'Implemented',
    purpose: 'Points ↓ → pairwise comparison share ↓ → display label ↑.',
    sources: [[api + 'leaderboard/standings.rs:293', 'sort_by_rank']],
    fields: [select('view', 'Leaderboard view', [['verified', 'Verified'], ['pending', 'Pending']]), range('bea', 'Bea verified points', 0, 150, 100)],
    build(v) {
      const rows = [{ name: 'Ana', verified: 100, pending: 20, wins: 1, total: 2 }, { name: 'Bea', verified: v.bea, pending: 30, wins: 3, total: 4 }, { name: 'Cal', verified: 100, pending: 30, wins: 3, total: 4 }, { name: 'Dan', verified: 80, pending: 40, wins: 1, total: 2 }];
      const points = [...rows].sort((a, b) => b[v.view] - a[v.view]);
      const shares = [...rows].sort((a, b) => b[v.view] - a[v.view] || b.wins * a.total - a.wins * b.total);
      const sorted = [...rows].sort((a, b) => b[v.view] - a[v.view] || b.wins * a.total - a.wins * b.total || a.name.localeCompare(b.name, 'en'));
      return model([
        step('Eligible entries', 'Ana · Bea · Cal · Dan', 'Sample entries lamang; naka-scope na sa season ang tunay na input.'),
        step('Primary score', v.view === 'pending' ? 'Pending points ↓' : 'Verified points ↓', 'Kapag pending ang view, pending ang primary key; kung hindi, verified.'),
        step('Point order', points.map(r => r.name).join(' → '), 'Higher points muna. Kapag tabla, saka gagamit ng comparison share.'),
        step('Comparison share', '3/4 > 1/2', 'Cross-products ang comparison: bw × at kumpara sa aw × bt. Neutral 1/2 kapag walang comparison record.'),
        step('Label tie-break', 'Bea bago Cal', 'Parehong points at comparison share: ascending display label ang huling tie-breaker.'),
        step('Final order', sorted.map(r => r.name).join(' → '), 'Deterministic total order. Hindi ipinapakita rito ang isang partikular na internal sorting algorithm ng Rust.')
      ], sorted.map(r => r.name).join(' › '), { kind: 'bars', frames: [rows, rows, points, shares, sorted, sorted], field: v.view });
    }
  },
  {
    id: 'tiers', group: 'EVIDENCE & RANKING', name: 'Cohort quantiles', status: 'Implemented',
    purpose: 'Season rank → quantile band → tier + division + percentile.',
    sources: [[api + 'leaderboard/tiers.rs:16', 'tier_of_cohort']],
    fields: [range('rank', 'Rank sa 12-member cohort', 1, 12, 3), range('tiers', 'Sample tier count', 2, 6, 4), select('positive', 'May verified points?', yesNo)],
    build(v) {
      const below = 12 - v.rank;
      const band = Math.floor(below * v.tiers * 3 / 12);
      const tier = Math.min(Math.floor(band / 3), v.tiers - 1);
      const division = ['III', 'II', 'I'][band % 3];
      const percentile = Math.floor(below * 100 / 11);
      return model([
        step('Ranked eligibility', v.positive === 'yes' ? 'Verified points > 0 ✓' : 'Zero points → Unranked', 'Zero points, empty cohort, o walang tier definitions: Unranked / III / 0.'),
        step('Members below', `12 − ${v.rank} = ${below}`, 'below = cohort_size.saturating_sub(rank).'),
        step('Quantile band', `floor(${below} × ${v.tiers} × 3 / 12) = ${band}`, 'May tatlong divisions sa bawat tier; integer division ang ginagamit.'),
        step('Tier index', `floor(${band} / 3) = ${tier}`, 'Index ay capped sa tier_count − 1. T1…Tn ay sample labels lamang.'),
        step('Division', `${band} mod 3 → ${division}`, 'Remainder 0: III; 1: II; 2: I.'),
        step('Percentile', `${percentile}% · T${tier + 1} ${division}`, 'floor(below × 100 / (cohort_size − 1)). Kapag iisang member: 100%.')
      ], v.positive === 'yes' ? `T${tier + 1} ${division} · ${percentile}%` : 'UNRANKED', { kind: 'cohort', rank: v.rank, tiers: v.tiers, percentile }, v.positive === 'yes' ? 5 : 0);
    }
  },
  {
    id: 'streak', group: 'EVIDENCE & RANKING', name: 'Weekly streak scan', status: 'Implemented',
    purpose: 'Start sa current o previous week; scan paatras hanggang unang gap.',
    sources: [[api + 'leaderboard/standings.rs:278', 'streak']],
    fields: [select('pattern', 'Verified activity weeks', [['continuous', 'W8 W9 W10 W11 W12'], ['grace', 'W8 W9 W10 W11'], ['gap', 'W8 W10 W11 W12'], ['old', 'W7 W8 W9']])],
    build(v) {
      const sets = { continuous: [8, 9, 10, 11, 12], grace: [8, 9, 10, 11], gap: [8, 10, 11, 12], old: [7, 8, 9] };
      const weeks = new Set(sets[v.pattern]);
      let cursor = weeks.has(12) ? 12 : 11;
      let count = 0;
      while (weeks.has(cursor)) { count++; cursor--; }
      const start = weeks.has(12) ? 12 : 11;
      return model([
        step('Verified week set', sets[v.pattern].map(w => `W${w}`).join(' · '), 'Deduplicated verified weeks ang input; maraming events sa isang linggo ay isang week lang.'),
        step('Current week', 'Sample current = W12', 'Week index lang ang sample. Ang tunay na current week ay galing sa current_week(now).'),
        step('Choose starting week', `Start sa W${start}`, 'Kung active ang current week, doon magsisimula; kung hindi, sa previous week.'),
        step('Backward scan', count ? `W${start} → W${start - count + 1}` : 'Walang matching week', 'Habang nasa set ang week: count += 1; week -= 1.'),
        step('First gap', `W${cursor} missing → STOP`, 'Hindi nilalaktawan ang gap kahit may mas lumang activity.'),
        step('Streak length', `${count} consecutive weeks`, 'Current week na walang event ay hindi agad sumisira sa streak kung active ang previous week.')
      ], `${count} WEEKS`, { kind: 'weeks', active: [...weeks], start, gap: cursor, count });
    }
  },
  {
    id: 'mtls', group: 'SECURITY SERVICE', name: 'mTLS + leaf pin', status: 'Local / staged',
    purpose: 'Private listener → trusted client certificate → exact leaf pin → request context.',
    sources: [[identity + 'secure_transport.rs:37', 'ServerTls::from_pem · serve']],
    fields: [select('ca', 'Trusted client CA?', yesNo), select('pin', 'Leaf fingerprint match?', yesNo)],
    build(v) {
      const stop = v.ca === 'no' ? 2 : v.pin === 'no' ? 3 : 5;
      return model([
        step('Private listener', 'Loopback / private IP', 'Public bind addresses ay hindi pinapayagan ng service.'),
        step('TLS handshake', 'Server cert + client cert', 'Mutual TLS: kailangan ding magpakita ng certificate ang client.'),
        step('Client CA validation', v.ca === 'yes' ? 'CA-validated certificate ✓' : 'TLS verification failed ✕', 'Rustls ang certificate verifier. Conceptual handshake ang visual, hindi reimplementation ng TLS.'),
        step('Leaf fingerprint', v.pin === 'yes' ? 'SHA-256 leaf pin matches ✓' : 'Wrong service pin ✕', 'Kahit valid sa private CA, dapat tumugma sa pinned website-client leaf fingerprint.'),
        step('Request context', 'Viewer · request ID · purpose', 'Fresh, well-formed context pa rin ang kailangan pagkatapos ng transport trust.'),
        step('Trusted request', 'Forward sa identity router', 'Walang browser header na mag-isang makakalikha ng trusted transport context.')
      ], stop < 5 ? 'TRANSPORT DENIED' : 'TRUSTED PEER ✓', { kind: 'gates', items: ['PRIVATE IP', 'CLIENT CA', 'LEAF PIN', 'CONTEXT'] }, stop, stop < 5);
    }
  },
  {
    id: 'freshness', group: 'SECURITY SERVICE', name: 'Request freshness', status: 'Local / staged',
    purpose: 'Parse IDs + allowlisted purpose + absolute timestamp skew ≤ 60 seconds.',
    sources: [[identity + 'secure_transport.rs:152', 'verified_request']],
    fields: [range('skew', 'Timestamp offset · seconds', -120, 120, 20), select('ids', 'Valid UUID headers?', yesNo), select('purpose', 'Purpose', [['organization_chart', 'Organization chart'], ['public_profile', 'Public profile'], ['leaderboard_photo', 'Leaderboard photo'], ['unknown', 'Unknown purpose']])],
    build(v) {
      const stop = v.ids === 'no' ? 1 : v.purpose === 'unknown' ? 2 : Math.abs(v.skew) > 60 ? 4 : 5;
      return model([
        step('Verified transport', 'After mTLS + leaf pin', 'Freshness validation ay nasa loob ng trusted service boundary.'),
        step('Parse UUID headers', v.ids === 'yes' ? 'Request ID + viewer ID ✓' : 'Invalid UUID ✕', 'Parehong request UUID at viewer UUID ang kailangang ma-parse.'),
        step('Purpose allowlist', v.purpose, 'public_profile, organization_chart, at leaderboard_photo lang ang tinatanggap ng kasalukuyang source.'),
        step('Absolute time difference', `|now − timestamp| = ${Math.abs(v.skew)}s`, 'Absolute difference: parehong lumang timestamp at sobrang future timestamp ay nasusuri.'),
        step('Skew boundary', Math.abs(v.skew) <= 60 ? `${Math.abs(v.skew)} ≤ 60 ✓` : `${Math.abs(v.skew)} > 60 ✕`, 'Exactly 60 seconds ay accepted. Higit sa 60 ay rejected. Freshness ito, hindi buong duplicate-request prevention.'),
        step('VerifiedPeer', 'viewer + purpose + request ID', 'Kapag pumasa lang sa lahat, nabubuo ang trusted request context.')
      ], stop < 5 ? 'CONTEXT DENIED' : 'FRESH CONTEXT ✓', { kind: 'clock', skew: v.skew }, stop, stop < 5);
    }
  },
  {
    id: 'consent', group: 'SECURITY SERVICE', name: 'Display-name access', status: 'Local / staged',
    purpose: 'Existing identity AND (owner OR visible setting OR active purpose consent).',
    sources: [[identity + 'identities.rs:5', 'resolve_display_name']],
    fields: [select('exists', 'May identity row?', yesNo), select('owner', 'Owner ang viewer?', yesNo, 'no'), select('visible', 'real_name_visible?', yesNo, 'no'), select('consent', 'Active purpose consent?', yesNo)],
    build(v) {
      const allow = v.exists === 'yes' && [v.owner, v.visible, v.consent].includes('yes');
      return model([
        step('Trusted caller', 'Transport verified', 'Demo ay nagsisimula pagkatapos ng transport at purpose checks.'),
        step('Identity exists?', v.exists === 'yes' ? 'Identity row ✓' : 'No identity row', 'Walang identity row: walang display-name result, kahit anong consent flags.'),
        step('Owner branch', v.owner === 'yes' ? 'viewer_id = member_id ✓' : 'Different viewer', 'Owner ay isang independent allow branch ng query.'),
        step('Visibility branch', v.visible === 'yes' ? 'real_name_visible = 1 ✓' : 'Not globally visible', 'Kasama sa kasalukuyang code ang identity_settings.real_name_visible branch.'),
        step('Purpose consent branch', v.consent === 'yes' ? 'Exact purpose + unrevoked ✓' : 'Missing / revoked consent', 'Consent ay dapat para sa eksaktong purpose at revoked_at IS NULL.'),
        step('SQL result', allow ? 'Display name available ✓' : 'No row → unavailable', 'Ang OR branches ay conceptual na inilalantad; hindi nito ipinapangako ang internal SQL evaluation order.')
      ], allow ? 'NAME AVAILABLE ✓' : 'UNAVAILABLE', { kind: 'consent', exists: v.exists === 'yes', flags: [v.owner, v.visible, v.consent].map(x => x === 'yes') }, v.exists === 'no' ? 1 : 5, !allow);
    }
  },
  {
    id: 'photo', group: 'SECURITY SERVICE', name: 'Photo processing', status: 'Local / staged',
    purpose: 'Bounded bytes → format + dimensions → thumbnail → WebP quality fallback.',
    sources: [[identity + 'transport/photo.rs:81', 'write_photo'], [identity + 'transport/photo.rs:386', 'compress_photo']],
    fields: [range('bytes', 'Input · KiB', 32, 448, 256), select('dimensions', 'Image dimensions', [['safe', '1200 × 900'], ['wide', '2200 × 900'], ['pixels', '2048 × 2048']]), select('quality', 'Synthetic encoded sizes', [['first', 'Q65: 48 KiB'], ['retry', 'Q65: 80 · Q45: 60 KiB'], ['fail', 'Lahat higit 64 KiB']])],
    build(v) {
      const stop = v.bytes > 384 ? 0 : v.dimensions !== 'safe' ? 2 : v.quality === 'fail' ? 4 : 5;
      const quality = v.quality === 'retry' ? 45 : 65;
      return model([
        step('Input byte limit', `${v.bytes} KiB / 384 KiB`, 'Sample ay authorized owner at writes-enabled path. Reject kapag empty o higit 384 KiB.'),
        step('Format detection', 'JPEG / PNG / WebP only', 'Guessed format ang chine-check; hindi basta nagtitiwala sa filename.'),
        step('Dimension guard', v.dimensions === 'safe' ? '1200 × 900 ✓' : v.dimensions === 'wide' ? 'Width 2200 > 2048 ✕' : '4,194,304 > 4,000,000 px ✕', 'Nonzero dimensions; bawat side ≤2048; kabuuang pixels ≤4,000,000 bago decode.'),
        step('Decode + resize', 'Triangle filter → ≤160 × 160', 'Preserved ang aspect ratio. Re-encoded RGB thumbnail ang output; source metadata ay hindi kinokopya.'),
        step('Quality fallback', v.quality === 'first' ? 'Q65 → 48 KiB ✓' : v.quality === 'retry' ? 'Q65 ✕ → Q45 → 60 KiB ✓' : 'Q65 ✕ → Q45 ✕ → Q25 ✕', 'Sinusubukan ang 65, 45, 25 hanggang may nonempty output ≤64 KiB. Mock sizes ito; hindi totoong codec result.'),
        step('Bounded WebP', `≤64 KiB · quality ${quality}`, 'Kung walang pumasa sa tatlong encoding attempts, failure ang compression.')
      ], stop < 5 ? 'PHOTO REJECTED' : 'BOUNDED WEBP ✓', { kind: 'photo', bytes: v.bytes, quality, retry: v.quality === 'retry', fail: v.quality === 'fail' }, stop, stop < 5);
    }
  },
  {
    id: 'idempotence', group: 'SECURITY SERVICE', name: 'Consent retry handling', status: 'Local / staged',
    purpose: 'Request ID lookup → same payload retry or conflicting reuse → transaction.',
    sources: [[identity + 'transport/photo.rs:196', 'write_photo_consent']],
    fields: [select('request', 'Request ID history', [['new', 'Bagong request ID'], ['same', 'Retry · parehong payload'], ['conflict', 'Parehong ID · ibang payload']]), select('writes', 'Writes enabled?', yesNo)],
    build(v) {
      const stop = v.writes === 'no' ? 0 : v.request === 'conflict' ? 3 : 5;
      return model([
        step('Write gate', v.writes === 'yes' ? 'Writes enabled ✓' : '503 · writes disabled', 'Default-off ang writes; kailangan din ng verified chart owner bago ang transaction.'),
        step('BEGIN + request lookup', 'Lookup by request UUID', 'Hinahanap sa consent log kung nagamit na ang request ID.'),
        step('Prior record?', v.request === 'new' ? 'Walang prior record' : 'May prior record', 'Naka-transaction ang lookup at writes.'),
        step('Payload identity', v.request === 'conflict' ? '409 · mismatched member/value' : v.request === 'same' ? 'Same member + granted value ✓' : 'New ID → insert consent + log', 'Kapag existing ID, dapat pareho ang member ID at granted value.'),
        step('Consent + settings', v.request === 'same' ? 'Skip duplicate consent log' : 'UPSERT consent + INSERT log', 'Sa parehong retry, hindi dinodoble ang consent/log row; inu-update pa rin ang photo_visible setting.'),
        step('COMMIT + reply', 'Return granted value ✓', 'Magkakasama ang consent at settings update; conflicting reuse ay walang commit.')
      ], stop < 5 ? v.writes === 'no' ? '503 · DISABLED' : '409 · CONFLICT' : v.request === 'same' ? 'SAFE RETRY ✓' : 'CONSENT SAVED ✓', { kind: 'transaction', items: ['REQUEST ID', 'LOOKUP', 'COMPARE', 'SETTINGS', 'COMMIT'] }, stop, stop < 5);
    }
  },
  {
    id: 'photo-access', group: 'SECURITY SERVICE', name: 'Photo visibility paths', status: 'Local / staged',
    purpose: 'Shared chart/leaderboard reads versus owner-only public-profile reads.',
    sources: [[identity + 'transport/photo.rs:24', 'read_photo · read_self_photo · photo_response'], [identity + 'transport/photo.rs:362', 'photo_consent · leaderboard_photo_consent']],
    fields: [select('route', 'Read path', [['shared', 'Chart / leaderboard'], ['self', 'Owner profile']]), select('owner', 'Owner ang viewer?', yesNo), select('visible', 'photo_visible?', yesNo, 'no'), select('exists', 'May photo bytes?', yesNo)],
    build(v) {
      const denied = v.route === 'shared' ? v.visible === 'no' : v.owner === 'no';
      const stop = denied ? 2 : v.exists === 'no' ? 3 : 5;
      return model([
        step('Trusted caller', 'mTLS + verified context', 'Visual ay nagsisimula sa verified peer; transport errors ay nasa mTLS lab.'),
        step('Purpose-bound route', v.route === 'shared' ? 'organization_chart / leaderboard_photo' : 'public_profile + owner', 'Magkaibang read handler ang shared view at owner profile.'),
        step('Visibility / owner gate', v.route === 'shared' ? v.visible === 'yes' ? 'photo_visible = 1 ✓' : 'Photo hidden → 404' : v.owner === 'yes' ? 'Owner verified ✓' : 'Not owner → denied', 'Shared reads require photo_visible kahit owner. Sa owner-only public_profile route, walang shared-visibility check.'),
        step('Load stored WebP', v.exists === 'yes' ? 'identity_photos.webp found ✓' : 'No photo bytes → 404', 'Kasalukuyang photo_visible setting ang binabasa ng parehong chart at leaderboard consent helpers.'),
        step('Private response', 'private, no-store · nosniff', 'WebP bytes lamang. Hindi cacheable ang authenticated photo response.'),
        step('Photo available', 'image/webp ✓', 'Ang display-name visibility at photo visibility ay magkaibang setting at query.')
      ], stop < 5 ? 'PHOTO UNAVAILABLE' : 'PHOTO AVAILABLE ✓', { kind: 'gates', items: ['PURPOSE', v.route === 'shared' ? 'VISIBILITY' : 'OWNER', 'PHOTO ROW', 'NO-STORE'] }, stop, stop < 5);
    }
  },
  {
    id: 'capacity', group: 'SECURITY SERVICE', name: 'Bounded concurrency', status: 'Local / staged',
    purpose: 'Semaphore permits bound simultaneous connections or image processing jobs.',
    sources: [[identity + 'secure_transport.rs:64', 'serve · acquire_owned · handshake / connection timeouts'], [identity + 'transport/photo.rs:105', 'PHOTO_PROCESSING.acquire → spawn_blocking']],
    fields: [select('pool', 'Resource pool', [['photo', 'Photo workers · 4 permits'], ['tls', 'TLS connections · 64 permits']]), range('requests', 'Sample arriving jobs', 1, 80, 7)],
    build(v) {
      const limit = v.pool === 'photo' ? 4 : 64, running = Math.min(v.requests, limit), waiting = Math.max(0, v.requests - limit);
      return model([
        step('Arriving work', `${v.requests} sample jobs`, 'Resource pools ay magkahiwalay; hindi nila pinaghahatian ang iisang semaphore.'),
        step('Semaphore permits', `${limit} maximum active`, v.pool === 'photo' ? 'Static semaphore na may apat na photo-processing permits.' : '64 permits. Ina-acquire bago ang listener.accept; excess connections may wait sa OS backlog.'),
        step('Acquire permit', `${running} active · ${waiting} waiting`, 'Kung walang permit, maghihintay ang acquire. Hindi ito automatic HTTP rejection.'),
        step('Bounded processing', v.pool === 'photo' ? 'spawn_blocking(compress_photo)' : 'TLS ≤5s · HTTP connection ≤30s', v.pool === 'photo' ? 'Blocking codec work ay inililipat sa blocking task pool pagkatapos makuha ang permit.' : 'May handshake timeout at hiwalay na timeout para sa buong HTTP connection.'),
        step('Completion / failure', 'Permit drops → slot released', 'Ang permit ay hawak habang tumatakbo ang scoped task; release kapag natapos o bumalik sa error path.'),
        step('Waiting work proceeds', waiting ? `${waiting} jobs awaiting slots` : 'Walang waiting jobs', 'Schematic capacity snapshot ito, hindi pangako ng timing o OS queue capacity.')
      ], `${running} ACTIVE · ${waiting} WAIT`, { kind: 'capacity', running, waiting, limit });
    }
  },
  {
    id: 'startup', group: 'SECURITY SERVICE', name: 'Fail-closed startup', status: 'Local / staged',
    purpose: 'Configuration + initialized database + credentials bago mag-bind ng socket.',
    sources: [[identity + 'startup.rs:36', 'Config::from_env · Config::new · run']],
    fields: [select('fault', 'Startup scenario', [['none', 'Valid local configuration'], ['public', 'Public bind address'], ['db', 'Missing database file'], ['credentials', 'Invalid TLS credentials']])],
    build(v) {
      const stop = { none: 5, public: 1, db: 2, credentials: 4 }[v.fault];
      return model([
        step('Read configuration', 'Bind · DB path · credential dir', 'Paths at private bind address ang config; hindi inilalagay sa visual ang secret values.'),
        step('Private bind check', v.fault === 'public' ? 'public_bind_denied ✕' : 'Private / loopback ✓', 'Public address: fail bago magbukas ng listener.'),
        step('Database file', v.fault === 'db' ? 'db_file_required ✕' : 'Existing absolute file ✓', 'Kailangang absolute path at existing file ang database.'),
        step('Open + validate schema', 'Initialized identity tables', 'Database opens read-only kapag writes disabled; explicit true ang kailangan para sa writes.'),
        step('Load bounded credentials', v.fault === 'credentials' ? 'TLS credential validation ✕' : 'Cert · key · CA · pin ✓', 'Bounded credential files ang nilo-load bago mag-bind.'),
        step('Bind + serve', 'mTLS listener ready ✓', 'Pagkatapos lamang ng validations magbi-bind. Failure ay may structured error code.')
      ], stop < 5 ? 'NO LISTENER' : 'SERVICE READY ✓', { kind: 'gates', items: ['CONFIG', 'DB', 'CREDENTIALS', 'BIND'] }, stop, stop < 5);
    }
  }
];

const $ = selector => document.querySelector(selector);
const svg = $('#canvas');
const scene = $('#scene');
let activeLab, inputs = {}, currentModel, cursor = 0, timer = null;
let viewBox = [0, 0, 1100, 470], drag = null;
let followStep = window.innerWidth <= 650;
const positions = [[35, 45], [395, 45], [755, 45], [755, 205], [395, 205], [35, 205]];

function svgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text;
  return element;
}

function buildCatalog() {
  let previousGroup;
  for (const [index, lab] of labs.entries()) {
    if (previousGroup !== lab.group) {
      const label = document.createElement('div');
      label.className = 'group-title'; label.textContent = lab.group;
      $('#catalog').append(label); previousGroup = lab.group;
    }
    const button = document.createElement('button');
    button.className = 'lab-button'; button.dataset.lab = lab.id;
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    button.append(number, document.createTextNode(lab.name));
    button.onclick = () => { location.hash = lab.id; };
    $('#catalog').append(button);
  }
}

function chooseLab() {
  pause();
  followStep = window.innerWidth <= 650;
  activeLab = labs.find(lab => lab.id === location.hash.slice(1)) || labs[0];
  inputs = Object.fromEntries(activeLab.fields.map(field => [field.key, field.initial]));
  $('#title').textContent = activeLab.name;
  $('#purpose').textContent = activeLab.purpose;
  $('#category').textContent = activeLab.group;
  $('#status').textContent = activeLab.status;
  $('#status').style.color = activeLab.status === 'Implemented' ? '#65ddba' : '#ffc477';
  document.querySelectorAll('[data-lab]').forEach(button => {
    if (button.dataset.lab === activeLab.id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  $('#source').replaceChildren(...activeLab.sources.map(([file, symbol]) => {
    const line = document.createElement('div'); line.textContent = `${file} · ${symbol}`; return line;
  }));
  buildInputs(); resetView(); rebuildModel();
}

function buildInputs() {
  $('#inputs').replaceChildren();
  for (const field of activeLab.fields) {
    const wrapper = document.createElement('div'); wrapper.className = 'field';
    const label = document.createElement('label'); label.htmlFor = `input-${field.key}`; label.textContent = field.label;
    const control = document.createElement(field.options ? 'select' : 'input');
    control.id = label.htmlFor;
    if (field.options) {
      for (const [value, name] of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = name; control.append(option); }
    } else { control.type = 'range'; control.min = field.min; control.max = field.max; }
    control.value = inputs[field.key];
    const output = document.createElement('output'); output.htmlFor = control.id;
    if (!field.options) { output.textContent = control.value; label.append(output); }
    control.addEventListener('input', () => {
      inputs[field.key] = field.options ? control.value : Number(control.value);
      output.textContent = control.value; rebuildModel();
    });
    wrapper.append(label, control); $('#inputs').append(wrapper);
  }
}

function rebuildModel() {
  pause(); cursor = 0; currentModel = activeLab.build(inputs);
  $('#scrub').max = currentModel.stop;
  render();
}

// Mental model: render the six source phases, then the lab-specific data transformation.
function render() {
  scene.replaceChildren();
  drawConnections();
  currentModel.steps.forEach(drawStep);
  drawArtifact();
  const item = currentModel.steps[cursor];
  $('#step-number').textContent = `HAKBANG ${cursor + 1} / ${currentModel.stop + 1}`;
  $('#step-title').textContent = item.label;
  $('#step-note').textContent = item.note;
  $('#counter').textContent = `${cursor + 1}/${currentModel.stop + 1}`;
  $('#scrub').value = cursor;
  $('#previous').disabled = cursor === 0;
  $('#next').disabled = cursor === currentModel.stop;
  $('#result').textContent = cursor === currentModel.stop ? currentModel.outcome : 'SINUSUNDAN…';
  $('#result').classList.toggle('bad', cursor === currentModel.stop && currentModel.denied);
  $('#stage-label').textContent = `${activeLab.name.toUpperCase()} · SYNTHETIC WALKTHROUGH`;
  if (followStep) focusCurrentStep();
}

function drawConnections() {
  for (let i = 0; i < 5; i++) {
    const [ax, ay] = positions[i], [bx, by] = positions[i + 1];
    const d = ay === by ? ax < bx ? `M${ax + 310} ${ay + 48} H${bx - 8}` : `M${ax} ${ay + 48} H${bx + 318}` : `M${ax + 155} ${ay + 96} V${by - 8}`;
    scene.append(svgElement('path', { d, class: `edge ${i < cursor ? 'past' : ''}` }));
  }
}

function drawStep(item, index) {
  const [x, y] = positions[index];
  const denied = index === cursor && cursor === currentModel.stop && currentModel.denied;
  const group = svgElement('g', { class: `step ${index < cursor ? 'past' : ''} ${index === cursor ? 'current' : ''} ${denied ? 'denied' : ''}`, transform: `translate(${x} ${y})`, role: 'button', tabindex: index <= currentModel.stop ? 0 : -1, 'aria-label': `${index + 1}. ${item.label}. ${item.value}`, 'aria-disabled': index > currentModel.stop });
  group.append(svgElement('rect', { class: 'card', width: 310, height: 96, rx: 13 }), svgElement('text', { x: 16, y: 22, class: 'number' }, `0${index + 1}${index < cursor ? '  ✓' : denied ? '  ✕' : ''}`), svgElement('text', { x: 16, y: 48, class: 'label' }, item.label));
  const value = svgElement('text', { x: 16, y: 73, class: 'value', textLength: item.value.length > 36 ? 278 : undefined }, item.value);
  if (item.value.length <= 36) value.removeAttribute('textLength');
  group.append(value);
  if (index > currentModel.stop) group.setAttribute('opacity', '.3');
  const visit = () => { if (index <= currentModel.stop) { pause(); cursor = index; render(); } };
  group.onclick = visit;
  group.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); visit(); } };
  scene.append(group);
}

function textAt(x, y, text, className = 'detail-text', attributes = {}) {
  scene.append(svgElement('text', { x, y, class: className, ...attributes }, text));
}

function drawArtifact() {
  const data = currentModel.artifact;
  textAt(35, 340, 'DATA VIEW · SAMPLE', 'artifact-label');
  if (data.kind === 'bars') drawRanking(data);
  else if (data.kind === 'cohort') drawCohort(data);
  else if (data.kind === 'weeks') drawWeeks(data);
  else if (data.kind === 'clock') drawClock(data);
  else if (data.kind === 'consent') drawConsent(data);
  else if (data.kind === 'photo') drawPhoto(data);
  else if (data.kind === 'capacity') drawCapacity(data);
  else drawTokens(data);
}

function drawRanking(data) {
  const rows = data.frames[cursor];
  for (const [index, row] of rows.entries()) {
    const x = 35 + index * 265;
    textAt(x, 368, `${index + 1}. ${row.name} · share ${row.wins}/${row.total}`);
    scene.append(svgElement('rect', { x, y: 380, width: 235, height: 24, rx: 5, fill: '#192a41' }), svgElement('rect', { x, y: 380, width: row[data.field] / 150 * 235, height: 24, rx: 5, fill: '#65ddba' }));
    textAt(x, 430, `${row[data.field]} ${data.field} points`);
  }
}

function drawCohort(data) {
  for (let i = 0; i < 12; i++) {
    const x = 40 + i * 85;
    scene.append(svgElement('rect', { x, y: 365, width: 68, height: 42, rx: 8, fill: i === data.rank - 1 ? '#ff8056' : '#1b3047', stroke: i === data.rank - 1 ? '#ffc4ab' : '#39516e' }));
    textAt(x + 22, 392, `#${i + 1}`);
  }
  textAt(40, 438, `← highest rank     ${data.tiers} sample tiers × 3 divisions     percentile = ${data.percentile}%`);
}

function drawWeeks(data) {
  for (let i = 6; i <= 12; i++) {
    const x = 40 + (i - 6) * 145, present = data.active.includes(i);
    const counted = i <= data.start && i > data.gap;
    scene.append(svgElement('rect', { x, y: 363, width: 120, height: 50, rx: 8, fill: present ? '#153b34' : '#151f31', stroke: i === data.gap && cursor >= 4 ? '#ff7389' : counted && cursor >= 3 ? '#ff8056' : '#35465e' }));
    textAt(x + 20, 394, `W${i}  ${present ? '✓' : '·'}`);
  }
  textAt(40, 442, `Scan ←   start W${data.start}   gap W${data.gap}   count ${data.count}`);
}

function drawClock(data) {
  scene.append(svgElement('rect', { x: 45, y: 377, width: 1000, height: 14, rx: 7, fill: '#27364d' }), svgElement('rect', { x: 295, y: 377, width: 500, height: 14, rx: 7, fill: '#236451' }));
  const x = 45 + (data.skew + 120) / 240 * 1000;
  scene.append(svgElement('circle', { cx: x, cy: 384, r: 11, fill: Math.abs(data.skew) <= 60 ? '#ff8056' : '#ff7389' }));
  for (const [px, label] of [[45, '−120s'], [295, '−60s'], [545, 'NOW'], [795, '+60s'], [1010, '+120s']]) textAt(px - 10, 422, label);
  textAt(45, 455, `Accepted window: [−60, +60] · current offset ${data.skew}s`);
}

function drawConsent(data) {
  const labels = ['OWNER', 'VISIBLE SETTING', 'PURPOSE CONSENT'];
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 280;
    scene.append(svgElement('rect', { x, y: 365, width: 245, height: 50, rx: 8, fill: data.flags[i] ? '#153b34' : '#2a2032', stroke: data.flags[i] ? '#65ddba' : '#ff738955' }));
    textAt(x + 14, 395, `${labels[i]} ${data.flags[i] ? '✓' : '✕'}`);
    if (i < 2) textAt(x + 253, 395, 'OR');
  }
  textAt(40, 447, `IDENTITY EXISTS ${data.exists ? '✓' : '✕'}  AND  (owner OR visible OR consent)`);
}

function drawPhoto(data) {
  scene.append(svgElement('rect', { x: 45, y: 360, width: 130, height: 82, rx: 9, fill: '#263c54', stroke: '#6b88aa' }), svgElement('path', { d: 'M50 436 L88 394 L112 416 L140 385 L170 436 Z', fill: '#688ca2' }));
  textAt(195, 390, `${data.bytes} KiB → decode → resize → RGB`);
  scene.append(svgElement('rect', { x: 605, y: 375, width: 75, height: 56, rx: 7, fill: '#325c4f', stroke: '#65ddba' }));
  textAt(700, 388, '≤160px · WebP');
  textAt(700, 414, data.fail ? '65 ✕ → 45 ✕ → 25 ✕' : data.retry ? '65 ✕ → 45 ✓' : '65 ✓');
  textAt(195, 445, 'Synthetic sizes · codec thresholds mula sa Rust source');
}

function drawTokens(data) {
  const items = data.items;
  const width = 1000 / items.length;
  for (const [index, name] of items.entries()) {
    const x = 40 + index * width;
    scene.append(svgElement('rect', { x, y: 370, width: width - 25, height: 55, rx: 9, fill: '#172b40', stroke: index <= cursor ? '#ff8056' : '#35465e' }));
    textAt(x + 14, 403, name, data.kind === 'equation' ? 'artifact-value' : 'detail-text');
    if (index < items.length - 1) textAt(x + width - 20, 403, '→');
  }
  if (data.kind === 'transaction') textAt(40, 453, 'ONE TRANSACTION · error → no commit');
}

function drawCapacity(data) {
  for (let i = 0; i < data.limit; i++) {
    const columns = data.limit === 4 ? 4 : 32;
    const x = 55 + (i % columns) * (data.limit === 4 ? 100 : 25);
    const y = 380 + Math.floor(i / columns) * 30;
    scene.append(svgElement('circle', { cx: x, cy: y, r: data.limit === 4 ? 20 : 8, fill: i < data.running ? '#65ddba' : '#23364f', stroke: '#52708f' }));
  }
  textAt(880, 386, `${data.waiting} WAITING`, 'artifact-value');
  textAt(45, 455, '● active permit    ○ available permit    completion → release → next');
}

function pause() {
  if (timer !== null) clearInterval(timer);
  timer = null; $('#play').textContent = '▶ Patakbuhin';
}

function advance(delta) {
  cursor = Math.max(0, Math.min(currentModel.stop, cursor + delta));
  if (cursor === currentModel.stop) pause();
  render();
}

function togglePlayback() {
  if (timer !== null) { pause(); return; }
  if (cursor === currentModel.stop) cursor = 0;
  render();
  if (currentModel.stop === 0) return;
  $('#play').textContent = 'Ⅱ I-pause';
  timer = setInterval(() => advance(1), 1400);
}

function applyView() { svg.setAttribute('viewBox', viewBox.join(' ')); }
function resetView() { viewBox = [0, 0, 1100, 470]; applyView(); }
function focusCurrentStep() {
  const [x, y] = positions[cursor];
  const width = window.innerWidth <= 650 ? 360 : 520;
  const height = width * svg.clientHeight / svg.clientWidth;
  viewBox = [x + 155 - width / 2, y + 48 - height / 2, width, height]; applyView();
}
function zoom(factor) {
  const width = Math.max(300, Math.min(2200, viewBox[2] * factor)), height = width * 470 / 1100;
  viewBox = [viewBox[0] + (viewBox[2] - width) / 2, viewBox[1] + (viewBox[3] - height) / 2, width, height]; applyView();
}

function connectControls() {
  $('#play').onclick = togglePlayback;
  $('#next').onclick = () => { pause(); advance(1); };
  $('#previous').onclick = () => { pause(); advance(-1); };
  $('#restart').onclick = () => { pause(); cursor = 0; render(); };
  $('#scrub').oninput = event => { pause(); cursor = Number(event.target.value); render(); };
  $('#zoomIn').onclick = () => zoom(.8); $('#zoomOut').onclick = () => zoom(1.25);
  $('#fit').onclick = () => { followStep = false; resetView(); };
  $('#focus').onclick = () => { followStep = true; focusCurrentStep(); };
  svg.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.1 : .9); }, { passive: false });
  svg.addEventListener('pointerdown', event => {
    if (event.target.closest('.step')) return;
    drag = { x: event.clientX, y: event.clientY, box: [...viewBox], scale: svg.getScreenCTM().a };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    viewBox = [drag.box[0] - (event.clientX - drag.x) / drag.scale, drag.box[1] - (event.clientY - drag.y) / drag.scale, ...drag.box.slice(2)]; applyView();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(type, () => { drag = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('hashchange', chooseLab);
}

buildCatalog();
connectControls();
chooseLab();
