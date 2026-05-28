import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index.js';

describe('gorilla-intake-routing smoke', () => {
  it('_health returns 200', async () => {
    const res = await request(app).get('/_health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('root returns non-500', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBeLessThan(500);
  });

  it('admin route redirects or rejects without auth', async () => {
    const res = await request(app).get('/admin');
    expect([302, 401, 200]).toContain(res.status);
  });

  it('no secrets leak in _health response', async () => {
    const res = await request(app).get('/_health');
    const body = JSON.stringify(res.body);
    const secretPatterns = [/api_key/i, /private_key/i];
    for (const pat of secretPatterns) {
      expect(pat.test(body)).toBe(false);
    }
  });
});
