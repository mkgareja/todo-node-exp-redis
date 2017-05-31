/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , io = require('socket.io')
  , redis = require('redis')
  , client = redis.createClient({host: 'localhost'})
  , co = require('co')
  , wrapper = require('co-redis')
  , redisCo = wrapper(client)
  , uuid = require('node-uuid');

var app = express();

app.configure(function(){
  app.set('port', process.env.PORT || 8080);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

var server = http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

var sio = io.listen(server);
// User count variable
var users = 0;

var address_list = new Array();

sio.sockets.on('connection', function (socket) {
  var address = socket.handshake.address;
  
  if (address_list[address]) {
    var socketid = address_list[address].list;
    socketid.push(socket.id);
    address_list[address].list = socketid;
  } else {
    var socketid = new Array();
    socketid.push(socket.id);
    address_list[address] = new Array();
    address_list[address].list = socketid;
  }

  users = Object.keys(address_list).length;

  socket.emit('count', { count: users });
  socket.broadcast.emit('count', { count: users });

  /* Handles 'all' namespace
  function: list all todos
  response: all todos, json format
  */
  co(function* () {
    var todos = [];
    var keys = yield redisCo.keys('todo-*');

    var i, id;
    for (i = 0; id = keys[i++];) {
      var item = yield redisCo.hgetall(id);
      todos.push({
        _id: id,
        title: item.title,
        complete: item.complete
      });
    }

    socket.emit('all', todos);
  });

  /* Handles 'add' namespace
  function: add a todo 
  Response: Todo object
  */
  socket.on('add', function(data) {
    var todo = {
      id: uuid.v1(),
      title: data.title,
      complete: 0
    };
    client.hmset('todo-' + todo.id, 'title', todo.title, 'complete', todo.complete, function() {
      socket.emit('added', todo);
      socket.broadcast.emit('added', todo);
    });
  });

  /* Handles 'delete' namespace
  function: delete a todo
  response: the delete todo id, json object
  */
  socket.on('delete', function(data) {
    client.del(data.id, function() {
      socket.emit('deleted', data);
      socket.broadcast.emit('deleted', data);
    });
  });

  /* Handles 'edit' namespace
  function: edit a todo
  response: edited todo, json object
  */
  socket.on('edit', function(data) {
    co(function* () {
      yield redisCo.hset(data.id, 'title', data.title);
      socket.emit('edited', data);
      socket.broadcast.emit('edited', data);
    });
  });

  /* Handles 'changestatus' namespace
  function: change the status of a todo
  response: the todo that was edited, json object
  */
  socket.on('changestatus', function(data) {
    co(function* () {
      var status = data.status === 'complete' ? 1 : 0;
      yield redisCo.hset(data.id, 'complete', status);
      socket.emit('statuschanged', data);
      socket.broadcast.emit('statuschanged', data);
    });
  });
  
  /* Handles 'allchangestatus' namespace
  function: change the status of all todos
  response: the status, json object
  */
  socket.on('allchangestatus', function(data) {
    co(function* () {
      var status = data.status === 'complete' ? 1 : 0;
      var keys = yield redisCo.keys('todo-*');

      var i, id;
      for (i = 0; id = keys[i++];) {
        yield redisCo.hset(id, 'complete', status);
      }

      socket.emit('allstatuschanged', data);
      socket.broadcast.emit('allstatuschanged', data);
    });
  });

  // disconnect state
  socket.on('disconnect', function(){
    var socketid = address_list[address].list;
    delete socketid[socketid.indexOf(socket.id)];
    if (Object.keys(socketid).length == 0) {
      delete address_list[address];
    }
    users = Object.keys(address_list).length;
    socket.emit('count', { count: users });
    socket.broadcast.emit('count', { count: users });
  });
});

// Our index page
app.get('/', routes.index);
