const accounts = require('./data/accounts.json');
const fs = require('fs');
module.exports = {
	accounts,
	get noAccounts () { return Object.keys(accounts) == 0; },
	saveAccounts () {
		fs.writeFile('./data/accounts.json', JSON.stringify(accounts), err => {
			// TODO: error reporting
		});
	}
}