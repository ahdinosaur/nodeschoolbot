#!/usr/bin/env node

var http = require('http')
var request = require('request')
var onjson = require('receive-json')
var minimist = require('minimist')
var crypto = require('crypto')

var argv = minimist(process.argv, {
  alias: {
    secret: 's',
    token: 't',
    port: 'p'
  }
})

if (!argv.secret) {
  console.error('--secret={webhook-secret} is required')
  process.exit(1)
}

if (!argv.token) {
  console.error('--token={github-token} is required')
  process.exit(1)
}

var CHAPTER_ORGANIZERS = 1660004

request = request.defaults({
  auth: {
    username: 'x-oauth',
    password: argv.token
  },
  headers: {
    'User-Agent': 'nodeschoolbot'
  }
})

var help = '' +
  'Here is what I can do for you:\n' +
  '\n' +
  '* `help` - shows this help\n' +
  '* `create-repo {name}` - creates a nodeschool repo\n' +
  '* `add-user {username}` - adds a user to the `chapter-organizers` team and the org\n'

var server = http.createServer(function (req, res) {
  if (req.method === 'GET') {
    res.end('hello, i am the nodeschoolbot\n')
    return
  }

  var hmac = crypto.createHmac('sha1', argv.secret)

  req.on('data', function (data) {
    hmac.update(data)
  })

  onjson(req, function (err, body) {
    if (err) return res.end()
    if ('sha1=' + hmac.digest('hex') !== req.headers['x-hub-signature']) return res.end()

    var cmd = parseCommand(body.comment && body.comment.body)
    if (!cmd) return res.end()

    var from = body.sender && body.sender.login
    if (from === 'nodeschoolbot') return res.end()

    if (!body.comment.body || !/@nodeschoolbot\s/.test(body.comment.body)) return res.end()

    if (cmd.args.length >= 1 && cmd.name === 'create-repo') {
      authenticate(function () {
        createRepository(cmd.args[0], function (err, result) {
          if (err) return done(err)
          var msg = 'I have created a new repo called [' + cmd.args[0] + '](https://github.com/nodeschool/' + cmd.args[0] + ')'
          comment(body, msg, done)
        })
      })
      return
    }

    if (cmd.args.length >= 1 && cmd.name === 'add-user') {
      authenticate(function () {
        addUser(cmd.args[0], function (err) {
          if (err) return done(err)
          var msg = 'I have added @' + cmd.args[0] + ' to the `chapter-organizers` team.'
          comment(body, msg, done)
        })
      })
      return
    }

    comment(body, help, done)

    function authenticate (cb) {
      request.get('https://api.github.com/teams/' + CHAPTER_ORGANIZERS + '/memberships/' + from, {
        json: true
      }, function (err, response) {
        if (err) return done(err)

        if (response.statusCode !== 200 || response.body.state !== 'active') {
          var msg = 'Sorry @' + from + '. You are not allowed to do that if you are not a member of the `chapter-organizers` team'
          comment(body, msg, done)
          return
        }

        cb()
      })
    }

    function done (err) {
      if (err) {
        console.error('Error: ' + err.stack)
        res.statusCode = 500
        res.end()
        comment(body, 'I have encountered an error doing this :(\n\n```\n' + err.stack + '\n```')
        return
      }
      res.end()
    }
  })
})

server.listen(argv.port || process.env.PORT || 8080, function () {
  console.log('nodeschoolbot is now listening for webhooks on %d', server.address().port)
})

function addUser (username, cb) {
  request.put('https://api.github.com/teams/' + CHAPTER_ORGANIZERS + '/memberships/' + username, {
    json: {
      role: 'member'
    }
  }, handleResponse(cb))
}

function createRepository (name, cb) {
  request.post('https://api.github.com/orgs/nodeschool/repos', {
    json: {
      name: name,
      description: 'repo for organizing the ' + name + ' nodeschools',
      homepage: 'https://nodeschool.github.io/' + name,
      private: false,
      has_issues: true,
      has_wiki: false,
      has_downloads: false,
      team_id: CHAPTER_ORGANIZERS,
      auto_init: true
    }
  }, handleResponse(cb))
}

function comment (body, msg, cb) {
  request.post('https://api.github.com/repos/' + body.repository.full_name + '/issues/' + body.issue.number + '/comments', {
    json: {
      body: msg
    }
  }, handleResponse(cb))
}

function handleResponse (cb) {
  return function (err, res) {
    if (err) return cb(err)
    if (!/2\d\d/.test(res.statusCode)) return cb(new Error('Bad status: ' + res.statusCode))
    cb()
  }
}

function parseCommand (comment) {
  if (!comment) return null
  var line = comment.match(/@nodeschoolbot\s([^\n]*)/)
  if (!line) return null
  var args = line[1].trim().split(/\s+/)
  return {
    name: args[0] || '',
    args: args.slice(1)
  }
}
