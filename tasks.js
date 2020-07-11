const fs = require('fs');
const term = require('./term');
const DataProvider = require('./data');
function parseType (stat) {
    if (stat.isDirectory()) return 'Directory';
    else if (stat.isFile()) return 'File';
    else if (stat.isSymbolicLink()) return 'SymbolicLink';
    else 'Unknown';
}

let sessions = {};
function getWelcomeInit (access) {
	const users = [];
	for (const id in sessions) {
		const session = session[id];
		if (!session.access) continue;
		const account = DataProvider.accounts[id];
		users.push({
			access: account.access,
			name: account.nick,
			color: account.color,
			files: session.files,
			terminals: session.terminals
		});
	}

	return { authed: true, users, access };
}

const https = require('https');
function fetchProfile (id) {
	return new Promise(resolve => {
		https.get('https://dc-collab-auth.herokuapp.com/api/get-profile?tmpID=' + id, res => {
			let body = '';
			res.on('data', chunk => body += chunk.toString());
			res.on('end', () => {
				resolve(JSON.stringify(body));
			});
		});
	});
}

let edits = {};
module.exports = {
	open () {
		setTimeout(() => {
			if (this.socket.status == 'pending') this.socket.end();
		}, 1000);
	},
	async auth (id) {
		this.socket.status = 'pending';
		const profile = await fetchProfile(id);

		let session = {
			id,
			profile,
			files: [],
			terminals: [],
			ctx: this
		};

		if (DataProvider.noAccounts) {
			session.access = 'admin';
			DataProvider.accounts[id] = {
				access: 'admin',
				nick: profile.nick,
				color: profile.color
			};

			DataProvider.saveAccounts();
		} else {
			const account = DataProvider.accounts[id];
			if (account) {
				session.access = account.access;
				account.nick = profile.nick;
				account.color = profile.color;
				DataProvider.saveAccounts();
			} else {
				session.pending = {
					id,
					nick: profile.nick,
					color: profile.color
				};

				let sended = false;
				for (const user of sessions) {
					if (user.access != 'admin') continue;
					sended = true;
					user.ctx.emit('approveConnection', {
						name: profile.nick,
						ip: this.socket.remoteAddress,
						id
					});
				}

				if (!sended) {
					this.emit('init', { authed: false, code: 'NoAdmins' });
					this.socket.end();
				}
			}
		}

		sessions[id] = session;
		this.socket.session = session;
		this.send('init', getWelcomeInit(session.access));
	},
	approveConnection (id, approved) {
		if (this.session.access != 'admin') return;
		const session = sessions[id];
		if (approved) {
			session.access = 'collaborator';
			DataProvider.accounts[id] = {
				access: 'collaborator',
				nick: session.pending.nick,
				color: session.pending.color
			};

			DataProvider.saveAccounts();
			delete session.pending;
			session.ctx.emit('init', getWelcomeInit());
		} else {
			session.ctx.emit('init', { authed: false, code: 'AdminRejected' });
			session.ctx.socket.end();
		}
	},
	close () {
		if (this.socket.status == 'logged') delete sessions[this.socket.session.id];
	},

	stat (path) {
		fs.stat(this.ROOT + '/' + path, (err, info) => {
			if (err) return this.error('stat', path, err);
			this.send('stat', path, {
				ctime: info.ctime.getTime(),
				mtime: info.mtime.getTime(),
				size: info.size,
				type: parseType(info)
			});
		});
	},
	readDirectory (path) {
		fs.readdir(this.ROOT + '/' + path, (err, list) => {
			if (err) return this.error('readDirectory', path, err);
			list = list.map(e => {
                return new Promise(resolve => {
                    fs.stat(this.ROOT + '/' + path + '/' + e, (err, stat) => {
                        if (err) resolve({ err });
                        else resolve([path + '/' + e, parseType(stat)]);
                    });
                });
            });
            Promise.all(list).then(result => this.send('readDirectory', path, result));
		});
	},
	readFile (path) {
		fs.readFile(this.ROOT + '/' + path, (err, data) => {
			if (err) return this.error('readFile', path, err);
			this.send('readFile', path, data.toString('utf8'));
			if (edits[path]) this.send('edit', path, edits[path]);
		})
	},
	writeFile (path, data) {
		fs.writeFile(this.ROOT + '/' + path, Buffer.from(data), err => {
			if (err) return this.error('writeFile', path, err);
			delete edits[path];
			this.broadcast('save', path);
			this.send('writeFile', path, true);
		});
	},
	delete (path) {
		fs.stat(this.ROOT + '/' + path, (err, stat) => {
			if (err) return this.error('delete', path, err);
			const resolve = err => {
				if (err) this.error('delete', path, err);
				else this.send('delete', path, true);
			};

			if (stat.isDirectory()) fs.rmdir(path, { recursive: true }, resolve);
			else fs.unlink(this.ROOT + '/' + path, resolve);
		});
	},

	cursor (data) {
		data.id = this.session.id;
		this.broadcast('cursor', data);
	},
	edit (path, e) {
		this.broadcast('edit', path, e);
		if (!edits[path]) edits[path] = e;
		else edits[path].push(...e);
	},

	term (type, data) {
		if (type in term) term[type].call(this, data);
	},

	openDocument (path) {
		const i = this.socketed.files.findIndex(file => file.path == path);
		if (!~i) {
			this.socketed.files.push({ path });
			this.broadcastAll('openDocument', { path, nick: this.socketed.nick });
		}
	},
	closeDocument (path) {
		const i = this.socketed.files.findIndex(file => file.path == path);
		if (~i) {
			this.socketed.files.splice(i, 1);
			this.broadcastAll('closeDocument', { path, nick: this.socketed.nick });
		}
	},
	activeDocuments (list) {
		for (const file of this.socketed.files) {
			if (~file.path.indexOf(list)) file.active = true;
			else delete file.active;
		}

		this.broadcastAll('activeDocuments', { list, nick: this.socketed.nick });
	}
};
