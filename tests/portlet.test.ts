import { addPortletLink } from '../src/portlet';

jest.mock('../src/Config', () => ({
	getPref: jest.fn().mockImplementation((prefName) => {
		let portletConfig = {
			portletArea: 'right-navigation',
			portletId: 'p-twinkle',
			portletName: 'TW',
			portletType: 'menu',
			portletNext: 'p-search',
		}; // copied from vector skin default config
		return portletConfig[prefName] || null;
	}),
}));

test('addPortletLink', () => {
	let pTwinkle = document.createElement('nav');
	pTwinkle.setAttribute('id', 'p-twinkle');
	document.body.appendChild(pTwinkle);

	let portletLink = addPortletLink(() => {}, 'Test portlet', 'tw-test', 'test portlet tooltip');
	expect(portletLink).toBeInstanceOf(HTMLLIElement);
});
