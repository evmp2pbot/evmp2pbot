[![MIT license](https://img.shields.io/badge/license-MIT-brightgreen)](./LICENSE)

# Installation
You will need to create an `.env` file on the root dir, you can use a sample env file called `.env.sample` on the root dir, an easy way of doing this is just to copy the sample file to `.env`.

```
cp .env-sample .env
```

## MongoDB
You will need to have [mongo](https://www.mongodb.com) installed and fill the mongo variables on the .env file, those that stats with `DB_`.

## Telegram
You will need a telegram bot api key (`BOT_TOKEN`), find out more about it [here](https://core.telegram.org/bots/).

## Tor service or another proxy
You can route the bot API via Tor service or another proxy if you specify 'SOCKS_PROXY_HOST' parameter in .env. For Ubuntu see [this](https://www.linuxuprising.com/2018/10/how-to-install-and-use-tor-as-proxy-in.html)


Please choose one of these two methods for your setup.

To install just run:
```
$ npm install
```
[Here](docs/INSTALL.md#installation) we have a detailed guide for installation and first steps using the bot.
# Running it
```
$ npm start
```
# Testing
```
$ npm test
```
