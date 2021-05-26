import './test_base';
import { Page } from '../src/Page';
import { Twinkle } from '../src/twinkle';

describe('Page', () => {
	test('can set edit summary with and without changeTags', () => {
		Twinkle.changeTags = 'twinkle';
		let page = new Page('Wikipedia:Sandbox');
		page.setEditSummary('edit summary');

		Twinkle.changeTags = '';
		page = new Page('Wikipedia:Sandbox');
		page.setEditSummary('edit summary');
	});
});
