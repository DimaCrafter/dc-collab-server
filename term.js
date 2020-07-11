var pty = require('node-pty');
const shells = {};

module.exports = {
	init () {
		const shell = pty.spawn('tmux', [], {
			name: 'xterm-256color',
			cols: 80,
			rows: 30,
			cwd: global.ROOT,
			env: process.env
		});
		  
		shell.onData(chunk => {
			this.send('term', 'output', { pid: shell.pid, chunk });
		});
		shell.onExit((code, signal) => {
			this.send('term', 'close', { pid: shell.pid, code });
			delete shells[shell.pid];
		});

		shells[shell.pid] = shell;
		this.send('term', 'created', { pid: shell.pid });
	},
	resize (data) { shells[data.pid].resize(data.columns, data.rows); },
	input (data) { shells[data.pid].write(data.chunk); },
	close (data) { shells[data.pid].kill(); },
	option (data) {
		shells[data.pid].write(`^B:setw ${data.prop} ${data.value ? 'on' : 'off'}\r`);
	}
};

process.on('SIGINT', () => {
	for (const pid in shells) shells[pid].kill();
	process.exit();
});
