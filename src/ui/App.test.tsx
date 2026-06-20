import { afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('App shell', () => {
  it('renders the five editor regions', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: /toolbar/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /assets/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /stage/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /inspector/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /timeline/i })).toBeInTheDocument();
  });

  it('applies the dark theme by default', () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
