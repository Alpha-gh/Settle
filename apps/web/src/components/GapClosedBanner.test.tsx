import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GapClosedBanner } from './GapClosedBanner';
import { TEST_IDS } from '../testids';
import { baselineForecast, afterPaymentForecast } from '../mocks/fixtures/forecast';

describe('GapClosedBanner Component', () => {
  it('does not render if session never experienced a breach (hadBreach = false)', () => {
    const { container } = render(
      <GapClosedBanner forecast={afterPaymentForecast} hadBreach={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render if currently in breach (firstBreachDate is non-null), even if hadBreach = true', () => {
    const { container } = render(
      <GapClosedBanner forecast={baselineForecast} hadBreach={true} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders green status banner when a breach was previously seen and latest forecast clears it', () => {
    render(<GapClosedBanner forecast={afterPaymentForecast} hadBreach={true} />);

    const banner = screen.getByTestId(TEST_IDS.gapClosedBanner);
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('Gap closed: your balance now stays above your reserve.');
    expect(banner).toHaveTextContent('Lowest balance: $6,325.00 on Fri 6 Nov.');
  });
});

