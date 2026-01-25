import type { ProjectRole } from './models';

export interface CreateUserRequest {
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
}

export interface CreateProjectRequest {
  name: string;
}

export interface AddMemberRequest {
  user_id: string;
  role: ProjectRole;
}

// API Error types
export interface ApiError {
  detail: string;
  status_code?: number;
}

// Utility types for component props
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  project_id?: string;
  type?: string;
  provider?: string;
}

// Response wrapper types
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
