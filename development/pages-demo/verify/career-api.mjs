// Isolated browser fixtures, not an identity service or a database implementation.
import { randomUUID } from 'node:crypto';
import { fixtureFor } from './mock-api.mjs';

export function careerApi() {
  const career = structuredClone(fixtureFor('member', '/api/product/career-evidence').body);
  const state = {
    career,
    resume: structuredClone(fixtureFor('member', '/api/product/resumes').body),
    profile: { complete: true, profile: { gender: 'prefer_not_to_say', regionCode: 'NCR', status: 'professional', channel: 'other', interests: [], analyticsConsent: true } },
    private: { displayName: 'Synthetic Owner', phoneNumber: '+639123456789' },
    consents: { realNameVisible: false, photoVisible: false, analyticsOptOut: false, hideGoogleIdentity: true, automaticErrorReports: false, shareAchievements: false },
    media: new Map(), photo: null, profileReads: 0, unavailable: false,
  };
  const reply = (body, status = 200) => ({ status, body: structuredClone(body) });
  const packageForOwner = () => ({ private: state.private, public: state.profile, consents: state.consents, achievements: career.evidence.items.filter(item => item.verificationState === 'user_verified') });

  function answer(_session, request, url, path) {
    const method = request.method();
    if (path === '/api/member/profile-package') {
      state.profileReads++;
      return state.unavailable ? reply({ error: 'Identity service unavailable' }, 503) : reply(packageForOwner());
    }
    if (path === '/api/member/consents') {
      if (method === 'PUT') state.consents = request.postDataJSON();
      return reply(state.consents);
    }
    if (path === '/api/member/private-profile' && method === 'PUT') {
      state.private.phoneNumber = request.postDataJSON().phoneNumber;
      return reply(state.private);
    }
    if (path === '/api/member/self-photo' || path === '/api/member/organization-photo') {
      if (method === 'PUT') { state.photo = request.postDataBuffer(); return reply({ saved: true }); }
      if (method === 'DELETE') { state.photo = null; return reply({ removed: true }); }
      return state.photo ? { status: 200, bytes: state.photo, contentType: 'image/webp' } : reply({ error: 'Photo unavailable' }, 404);
    }
    if (path === '/api/product/career-evidence') return reply(career);
    if (path === '/api/product/resumes') return reply(state.resume);
    if (path.startsWith('/api/product/evidence/media/')) {
      const bytes = state.media.get(path);
      return bytes ? { status: 200, bytes, contentType: 'image/jpeg' } : reply({ error: 'Media unavailable' }, 404);
    }
    if (path === '/api/product/evidence' && method === 'POST') return saveEvidence(request.postDataJSON(), url.origin);
    if (path.startsWith('/api/product/sources/') && method === 'POST') return saveSource(path.split('/').at(-1), request.postDataJSON());
    return null;
  }

  function saveEvidence(input, origin) {
    const id = randomUUID();
    let item;
    if (input.photoData) {
      const path = `/api/product/evidence/media/${id}`;
      state.media.set(path, Buffer.from(input.photoData.split(',')[1], 'base64'));
      item = { ...structuredClone(career.evidence.items[0]), id, title: input.title, sourceId: 'upload', mediaUrl: `${origin}/portal${path}`, verificationState: 'draft' };
    } else item = { ...input.item, id, verificationState: input.approve ? 'user_verified' : 'draft' };
    career.evidence.items.unshift(item);
    return reply({ item }, 201);
  }

  function saveSource(id, input) {
    const source = career.evidence.sources.find(item => item.id === id);
    if (!source) return reply({ error: 'Source not found' }, 404);
    if (!['connect', 'sync', 'disconnect'].includes(input.action)) return reply({ error: 'Invalid action' }, 400);
    if (input.url && !input.url.startsWith('https://')) return reply({ error: 'Invalid source URL' }, 400);
    const disconnected = input.action === 'disconnect';
    source.connectionStatus = disconnected ? 'disconnected' : 'connected';
    source.status = disconnected ? 'ready' : 'verified';
    if (disconnected) source.configuredUrl = null;
    else { source.lastSyncedAt = new Date().toISOString(); if (input.url) source.configuredUrl = input.url; }
    return reply({ source });
  }

  return { state, answer };
}
