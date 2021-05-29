module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	testURL: 'https://test.wikipedia.org/',
	globals: {
		'ts-jest': {
			diagnostics: {
				warnOnly: true,
			},
		},
	},
};