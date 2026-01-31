import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { Header } from './Header';
import { mockUser, mockProjects } from '@/test/mockData';

const defaultProps = {
  user: mockUser,
  projects: mockProjects,
  selectedProjectId: 'project-1',
  onProjectChange: vi.fn(),
};

describe('Header', () => {
  it('renders logo with correct alt text', () => {
    render(<Header {...defaultProps} />);
    const logo = screen.getByAltText('Polos');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/polos-logo-horizontal.png');
  });

  it('displays selected project name', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
  });

  it('renders settings button', () => {
    render(<Header {...defaultProps} />);
    const settingsButton = screen.getByRole('button', { name: /settings/i });
    expect(settingsButton).toBeInTheDocument();
  });

  // Note: Testing Radix UI Select interactions requires more complex setup
  // These tests focus on rendering and basic functionality
  // Integration tests with user interactions can be added later
});
