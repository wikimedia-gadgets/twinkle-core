export default {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	globals: {
		'ts-jest': {
			diagnostics: {
				warnOnly: true
			}
		}
	}
};
