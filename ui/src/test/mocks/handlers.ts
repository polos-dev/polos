import { http, HttpResponse } from 'msw';

const API_BASE_URL = 'http://localhost:8080';

// Default handlers for common API endpoints
// These can be overridden in individual tests using server.use()
export const handlers = [
  // Auth endpoints
  http.get(`${API_BASE_URL}/api/v1/auth/me`, () => {
    return HttpResponse.json({
      id: 'test-user-id',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'User',
      display_name: 'Test User',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }),

  // Projects endpoints
  http.get(`${API_BASE_URL}/api/v1/projects`, () => {
    return HttpResponse.json([
      {
        id: 'project-1',
        name: 'Test Project 1',
        created_at: new Date().toISOString(),
      },
      {
        id: 'project-2',
        name: 'Test Project 2',
        created_at: new Date().toISOString(),
      },
    ]);
  }),

  // Traces endpoints
  http.get(`${API_BASE_URL}/api/v1/traces`, () => {
    return HttpResponse.json([]);
  }),

  // Workflow runs endpoints
  http.get(`${API_BASE_URL}/api/v1/workflows/runs`, () => {
    return HttpResponse.json([]);
  }),

  // Agent runs endpoints (same as workflow runs)
  http.get(`${API_BASE_URL}/api/v1/agents/runs`, () => {
    return HttpResponse.json([]);
  }),

  // Tool runs endpoints
  http.get(`${API_BASE_URL}/api/v1/tools/runs`, () => {
    return HttpResponse.json([]);
  }),
];
