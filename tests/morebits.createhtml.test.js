require('./test_base');
const assert = require('assert');

describe('createHtml', () => {
	test('createHtml', () => {
		let fragment = Morebits.createHtml('string');
		expect(fragment.childNodes.length).toBe(1);
		expect(fragment.childNodes[0].nodeName).toBe('#text');

		fragment = Morebits.createHtml(Morebits.htmlNode('a', 'Anchor'));
		expect(fragment.childNodes.length).toBe(1);
		expect(fragment.childNodes[0].nodeName).toBe('A');

		fragment = Morebits.createHtml(['text', document.createElement('b')]);
		expect(fragment.childNodes.length).toBe(2);
		expect(fragment.childNodes[0].nodeName).toBe('#text');
		expect(fragment.childNodes[1].nodeName).toBe('B');

		fragment = Morebits.createHtml('Hi <script>alert("boom!")</script>');
		expect(fragment.childNodes.length).toBe(1);
		expect(fragment.childNodes[0].nodeName).toBe('#text');

	});

	test('renderWikilinks', () => {
		assert.strictEqual(
			Morebits.createHtml.renderWikilinks('[[Main Page]]'),
			`<a target="_blank" href="/index.php/Main_Page" title="Main Page">Main Page</a>`,
			'simple link'
		);
		assert.strictEqual(
			Morebits.createHtml.renderWikilinks('surrounding text [[Main Page|the main page]]'),
			`surrounding text <a target="_blank" href="/index.php/Main_Page" title="Main Page">the main page</a>`,
			'link with display text'
		);
		assert.strictEqual(
			Morebits.createHtml.renderWikilinks('surrounding text [["Weird Al" Yankovic]]'),
			`surrounding text <a target="_blank" href="/index.php/%22Weird_Al%22_Yankovic" title="&#34;Weird Al&#34; Yankovic">"Weird Al" Yankovic</a>`,
			// jsdom in node turns " in title attribute into &#34; whereas Chrome seems turns it into &quot;
			// but it works either way
			'link with double quote'
		);
	});
});
