import process from 'node:process';
import esbuild from 'esbuild';

import common from './esbuild.common';

(async () => {
	const diagnosticsVerbose = process.argv.includes('--diagnostic');
	const ctx = await esbuild.context({
		...common,
		define: {
			...common.define,
			'__DIAGNOSTICS_VERBOSE__': JSON.stringify(diagnosticsVerbose),
			'process.env.NODE_ENV': JSON.stringify('production'),
		},
	});
	if (process.argv.includes('--watch')) {
		await ctx.watch();
	}
	else {
		await ctx.rebuild();
		process.exit();
	}
})();
