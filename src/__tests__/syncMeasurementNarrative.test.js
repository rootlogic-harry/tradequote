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

  test('does not rewrite a longer length that merely contains the digits', () => {
    const text = 'An 11,200mm wall and 1,200mm coping.';
    expect(replaceMeasurementFigure(text, '1200', '1400')).toBe(
      'An 11,200mm wall and 1,400mm coping.',
    );
  });

  test('does not cascade the replacement into the new figure', () => {
    expect(replaceMeasurementFigure('45000mm of wall', '4500', '5200')).toBe('45000mm of wall');
    expect(replaceMeasurementFigure('a 500mm course', '500', '1500')).toBe('a 1500mm course');
  });

  test('leaves through-stone spacing and prices alone', () => {
    const text = 'Through stones at approximately 600mm height intervals. A 600mm thick wall. Allow £1,200.';
    expect(replaceMeasurementFigure(text, '600', '550')).toBe(
      'Through stones at approximately 600mm height intervals. A 550mm thick wall. Allow £1,200.',
    );
    expect(replaceMeasurementFigure(text, '1200', '1400')).toBe(text);
  });

  test('a half-typed figure does not touch the narrative', () => {
    expect(replaceMeasurementFigure('the 4,500mm breach', '4500', '4,')).toBe('the 4,500mm breach');
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
