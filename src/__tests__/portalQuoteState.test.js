import { buildPortalQuoteState } from '../utils/portalQuoteState.js';

describe('buildPortalQuoteState', () => {
  test('fills a stripped logo and splits named slots from extra photos', () => {
    const state = buildPortalQuoteState({
      snapshot: {
        jobDetails: { clientName: 'Vicky Burston', siteAddress: '103 Moorhead Lane' },
        reviewData: { damageDescription: 'Collapsed' },
        profile: { companyName: 'Old' },
      },
      profile: { companyName: 'Mark Doyle Walling', logo: '[photo-stripped]', phone: '0798' },
      liveLogo: 'data:image/png;base64,LOGO',
      photoRows: [
        { slot: 'overview', data: 'data:image/jpeg;base64,AAA', name: 'a.jpg' },
        { slot: 'extra-0', data: 'data:image/jpeg;base64,BBB', label: 'Breach' },
      ],
    });
    expect(state.profile.logo).toBe('data:image/png;base64,LOGO');
    expect(state.profile.companyName).toBe('Mark Doyle Walling');
    expect(state.photos.overview.data).toContain('AAA');
    expect(state.extraPhotos).toEqual([
      { data: 'data:image/jpeg;base64,BBB', label: 'Breach', name: '' },
    ]);
    expect(state.jobDetails.clientName).toBe('Vicky Burston');
  });

  test('keeps a real frozen logo and ignores a live one', () => {
    const state = buildPortalQuoteState({
      snapshot: {},
      profile: { logo: 'data:image/png;base64,FROZEN' },
      liveLogo: 'data:image/png;base64,LIVE',
      photoRows: [],
    });
    expect(state.profile.logo).toBe('data:image/png;base64,FROZEN');
  });
});
