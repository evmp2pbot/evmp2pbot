# Installation

*Spanish guide version [here](INSTALL.es.md)*

**The following document is intended to provide the necessary information to prepare the work environment for the development of the bot by providing the technical and physical characteristics of each element.**

## Table of contents
- [Purpose](#purpose)
- [Target](#target)
- [Scope](#scope-of-the-system)
- [Technical requirements](#technical-requirements)
- [Prepare the environment](#prepare-the-environment)
- [Docker](#docker)
- [MongoDB](#mongodb)
- [P2plnbot](#p2plnbot)
- [Connect to the Lightning node](#connect-to-the-lightning-node)


## Purpose.

To allow people to trade with other people on Telegram using the _Lightning_ network. The _p2plnbot_ bot is developed in nodejs and connects to a LND (Lightning Network Daemon) node is a full implementation of a Lightning Network node. 

## Target.

Achieving that the telegram bot is able to receive payments _Lightning_ without being custodian, that is; that the user will not need permission to use the service, or provide personal data 
that may compromise their privacy thereby achieving retain full custody of their goods at all times, for this the bot will use withheld invoices and only settle such invoices from the seller
 when each party agrees to it and just after that time the bot will pay the buyer's invoice. 

## Scope of the system.

Reach all users who require to acquire Bitcoin satoshis without custody through a bot on Telegram.

## Technical requirements. 

1) Computer with internet access. 
2) Node Management System [Polar.](https://lightningpolar.com/)

![polar](images/polar.jpg)


3) [Docker](https://www.docker.com/): deployment automation of applications as portable, self-contained containers that can be run in the cloud or locally.
4) [MogoDB](https://www.mongodb.com/) as a database manager.

## Prepare the environment.

1) Check if you have Nodejs installed.

```
$ node -v
```

In case you do not have it installed:

* On Mac run the following instruction:
```
$ brew install node
```

* On Windows go to the following [link](https://nodejs.org/en/download/)
* On Linux:

```
$ sudo apt install npm
```

## Docker

2) Create a directory where you will place the `docker-compose.yml` file for MongoDB with the following values:

```
mkdir mongodb
cd mongodb
mkdir db-data
vi docker-compose.yml
```

The file must contain the following:

```
version: "3.7"

services:
  mongodb:
    image: mongo:5.0
    environment:
      MONGO_INITDB_ROOT_USERNAME: mongoadmin
      MONGO_INITDB_ROOT_PASSWORD: secret
    volumes:
      - ./db-data/:/data/db
    ports:
      - 27017:27017
```

3) Check if Docker is up with the following instruction:

```
$ docker ps –a
```

_Note: When executing the first command you will see the image you have created._

* Lift the container.

```
$ docker-compose up –d
```

* To enter the container, you must execute the following instructions: 

```
$ docker ps –a
```

* This command will show you the ID that has been created to later enter the container:

```
$ docker exec -it <container id> /bin/bash
```

_Note: Entering the container will allow you to enter the DB._

## MongoDB

4) Login to MongoDB

```
$ mongo admin -u mongoadmin –p secret
$ show dbs
$ use nueva_db ej.
```

## P2plnbot

5) Clone the [repository](https://github.com/grunch/p2plnbot.git) of the bot:

```
$ git clone https://github.com/grunch/p2plnbot.git
$ cd p2plnbot
$ npm install
```
6) Create a `.env` file, in the root directory of the project, there is a sample file, so you only need to copy it and fill in some data:

* Execute the following instructions:

```
$ cp .env-sample .env
$ vi .env
```

## Connect to the Lightning node. 

• To connect to an `lnd` node, we need to set some variables:

**LND_CERT_BASE64:** TLS certificate of the LND node in base64 format, you can get it in base64 format. `~/.lnd/tls.cert | tr -d '\n'` in the lnd node.

**LND_MACAROON_BASE64:** Macaron file in base64 format, the macaron file contains permission to perform actions on the lnd node, you can get it with base64 `~/.lnd/data/chain/bitcoin/mainnet
/admin.macaroon | tr -d '\n',`

* If you are using Polar you get the data as shown in the following image:

![polarVariables](images/polarVariables.jpg)


**LND_GRPC_HOST:** IP address or the domain name from the LND node and the port separated by a colon, e.g: `192.168.0.2:10009.`

**BOT_TOKEN:** u will need to log in to Telegram and search for `BotFather.` Execute the menu and select `Create a new bot` where you will choose the name of the bot and the user, once gener
ated it will show a token number that will be placed in this field. 

**CHANNEL:** Create a channel in Telegram, to do this press the write new message button. On Android it is in the lower right corner with a round icon with a pencil, and on iOS it is in the 
upper right corner with a rather small icon in the shape of a pencil. Tap on the `New channel` option.

**ADMIN_CHANNEL:** This data will be the ID of your channel, to get it write a message in your channel, forward it to the bot `@JsonDumpBot` and it will show you a JSON with the channel ID. 

![telegram_bot](images/telegram_bot.jpg)

* More information [aquí.](https://gist.github.com/mraaroncruz/e76d19f7d61d59419002db54030ebe35)

* File `.env`

```
LND_CERT_BASE64=
LND_GRPC_HOST='127.0.0.1:10001'
BOT_TOKEN=''
FEE=.001
DB_USER='mongoadmin'
DB_PASS='secret'
DB_HOST='localhost'
DB_PORT='27017'
DB_NAME='p2plnbot'

INVOICE_EXPIRATION_WINDOW=60000
HOLD_INVOICE_EXPIRATION_WINDOW=60
CHANNEL='@yournewchannel' # channel created by you, the bot must be admin here
ADMIN_CHANNEL='-10******46' # Info dumped from the bot @JsonDumpBot

MAX_DISPUTES=8
HOLD_INVOICE_CLTV_DELTA=144
HOLD_INVOICE_CLTV_DELTA_SAFETY_WINDOW=12

PENDING_PAYMENT_WINDOW=5

FIAT_RATE_EP='https://api.yadio.io/rate'
```
• Once the file has been edited, execute the following instruction:

```
$ npm start
```

• For testing purposes:

```
$ npm test
```
