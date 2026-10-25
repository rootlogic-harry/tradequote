import { replaceMeasurementFigure, syncMeasurementNarrative } from '../utils/syncMeasurementNarrative.js';

describe('replaceMeasurementFigure', () => {
  test('rewrites comma and mm spellings of a corrected length', () => {
    const text = 'Clear the full 4,500mm breach, then rebuild 4500mm of wall.';
    expect(replaceMeasurementFigure(text, '4500', '5200')).toBe(
      'Clear the full 5,200mm breach, then rebuild 5200mm of wall.',
    );
  });

  test('leaves the sentence alone when the figure did not change', () => {
    const text = 'Rebuild 1,500mm high.';
    expect(replaceMeasurementFigure(text, '1500', '1,500')).toBe(text);
  });

  test('does not rewrite short numbers that collide with other copy', () => {
    const text = '2 workers for 8 days, through stones at 600mm.';
    expect(replaceMeasurementFigure(text, '8', '12')).toBe(text);
  });
});

describe('syncMeasurementNarrative', () => {
  test('updates the schedule and the damage description together', () => {
    const next = syncMeasurementNarrative({
      damageDescription: 'The breach is 4,500mm wide.',
      scheduleOfWorks: [
        { title: 'Rebuild the 4,500mm breach', description: 'Take back 4500 mm of loose stone.' },
      ],
      measurements: [],
    }, { previousValue: '4500', nextValue: '5100' });
    expect(next.damageDescription).toBe('The breach is 5,100mm wide.');
    expect(next.scheduleOfWorks[0].title).toBe('Rebuild the 5,100mm breach');
    expect(next.scheduleOfWorks[0].description).toBe('Take back 5100 mm of loose stone.');
  });
});
