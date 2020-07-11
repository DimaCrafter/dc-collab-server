const net = require('net');
const tasks = require('./tasks');
const ROOT = require('path').resolve(process.argv[2]);
global.ROOT = ROOT;
console.log('Usign root:', ROOT);

const connections = [];
const server = net.createServer(socket => {
	const ctx = {
		ROOT,
		send (event, ...args) { socket.write(Buffer.from(JSON.stringify([event, ...args]) + '\0')); console.log('<', event, ...args); },
		error (event, path, err) {
			err.path = err.path.slice(ROOT.length);
			this.send(event, path, { err });
		},
		broadcast (...args) { this._broadcast(args, false); },
		broadcastAll (...args) { this._broadcast(args, true); },
		_broadcast (args, skip) {
			for (const connection of connections) {
				if (!skip && connection == this) continue;
				connection.send(...args);
			}
		},
		socket
	};

	tasks.open.call(ctx);
	connections.push(ctx);
	socket.on('data', data => {
		data = data.toString('utf8').split('\0').slice(0, -1);
		for (let part of data) {
			try {
				part = JSON.parse(part);
				console.log('>', part);
				if (part[0] in tasks) tasks[part[0]].apply(ctx, part.slice(1));
			} catch {}
		}
	});

	socket.on('end', () => {
		tasks.close.call(ctx);
		const i = connections.indexOf(ctx);
		if (~i) connections.splice(i, 1);
	});
});

server.listen(5548, () => console.log('Listening port 5548'));
