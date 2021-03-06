var db = new PouchDB('sodashboard');

var locateDoc = function(id) {
  for(var i in app.docs) {
    var d = app.docs[i];
    if (d._id === id) {
      return d;
    }
  }
  return null;
};

var app = new Vue({
  el: '#app',
  data: {
    docs: null,
    userlist: null,
    mode: 'startup',
    numDocs: null,
    loggedinuser: null,
    profile: null,
    syncInProgress: false,
    syncError: false,
    syncComplete: false,
    filterTags: []
  },
  computed: {
    sortedDocs: function () {
      // get the app.docs but with tags sorted into order
      for(var i in this.docs) {
        this.docs[i].question.tags = this.docs[i].question.tags.sort();
      }
      return this.docs;
    },
    distinctTags: function() {
      // get distinct list of tags from tickets in the list
      var obj = {};
      for(var i in this.docs) {
        for(var j in this.docs[i].question.tags) {
          var tag = this.docs[i].question.tags[j];
          obj[tag] = true;
        }
      }
      return Object.keys(obj).sort();
    }
  },
  methods: {
    profileEditor: function() {
      // load the user profile
      db.get(app.loggedinuser._id).then(function(data) {
        // enable the profile editor
        app.profile = data;
        app.mode = 'profile';
        window.location.hash = '#profile';
      });
    },
    saveProfile: function() {
      // save the profile to PouchDB
      db.put(app.profile).then(function(data) {
        // return to startup mode
        app.profile._rev = data.rev;
        app.mode = 'startup';
        window.location.hash = '#';
      });
    },
    myTickets: function() {
     // load tickets assigned to me  
      var map = function(doc) {
        if (doc.question && (typeof doc.rejected === 'undefined' || doc.rejected === false) && doc.owner !== null) {
          emit(doc.owner, null);
        }
      };
      // get list of unassigned tickets, newest first
      db.query(map, {key: app.loggedinuser._id, include_docs:true}).then(function(data) {
        app.docs = [];
        for(var i in data.rows) {
          app.docs.push(data.rows[i].doc);
        }
        app.mode = 'mytickets';
        window.location.hash = '#mytickets';
      });
    },
    unAssignedTickets: function() {
      // load unassigned tickets
      var map = function(doc) {
        if (!doc.rejected && doc.owner === null) {
          emit(doc.question.creation_date, null);
        }
      };
      // get list of unassigned tickets, newest first
      db.query(map, {include_docs:true, descending: true}).then(function(data) {
        console.log('unAssignedTickets', data);
        app.docs = [];
        for(var i in data.rows) {
          app.docs.push(data.rows[i].doc);
        }
        app.mode = 'unassigned';
        window.location.hash = '#unassigned';
      });
    },
    onSyncChange: function(change) {
      // when we receive notification of a change
      app.syncInProgress = true;
      app.syncComplete = false;

      // if it's an incoming change (rather than us sending one to the cloud)
      if (change.direction === 'pull') {
        
        // for each change
        var inTheList = false;
        for (var i in change.change.docs) {
          var d = change.change.docs[i];
          
          // see if the document id that is changing is on our app.docs list
          for (var j in app.docs) {
            if (app.docs[j]._id === d._id) {
              // overwrite our copy with the one that has changed
              app.docs[j] = d;
              inTheList = true;
              break;
            }
          }

          // if we have a new unassigned ticket and we're in unassigned mode
          if (!intheList && app.mode === 'unassigned' && d.owner === null && d.status === 'new') {
            // add it to the top of our list
            app.docs.unshift(d);
          }
        }
      }
      
    },
    onSyncPaused: function(err) {
      app.syncComplete = true;
      app.syncInProgress = false;

      // load the doc count
      db.info().then(function(data) {
        app.numDocs = data.doc_count;

        // get a list of users
        var map = function(doc) {
          if (doc.type && doc.type === 'user') {
            emit(doc.user_name, null);
          }
        };
        return db.query(map);
      }).then(function(users) {
        var userlist = {};
        for(var i in users.rows) {
          var u = users.rows[i];
          userlist[u.id] = u.key;
        }
        app.userlist = userlist;
      });
    },
    onSyncError: function(err) {
      // sync error
      app.syncInProgress = false;
      app.syncComplete = false;
      app.syncError = true;
      console.log('error', err);
    },
    assign: function(id) {
      // called when someone clicks the assign button
      // find the doc that was rejected an update the database
      var doc = locateDoc(id);
      if (doc) {
        doc.assigned = true;
        doc.assigned_by = app.loggedinuser.user_id;
        doc.assigned_by_name = app.loggedinuser.user_name;
        doc.assigned_at = new Date().toISOString();
        db.put(doc).then(function(reply) {
          doc._rev = reply.rev;
        });
      }
    },
    reject: function(id) {
      // called when someone calls the reject button
      // find the doc that was rejected an update the database
      var doc = locateDoc(id);
      if (doc) {
        doc.rejected = true;
        doc.rejected_by = app.loggedinuser.user_id;
        doc.rejected_by_name = app.loggedinuser.user_name;
        doc.rejected_at = new Date().toISOString();
        db.put(doc).then(function(reply) {
          doc._rev = reply.rev;
        });
      }
    },
    logout: function() {
      db.destroy().then(function(data) {
        window.location = 'index.html';
      })
    }
  }
});

// on startup
db.get('_local/user').then(function(data) {

  // set the logged in user
  app.loggedinuser = data.user;

  // sync with Cloudant
  var auth = data.username + ':' + data.password;
  var url = data.url.replace(/\/\//, '//' + auth + '@');
  var opts = { live: true, retry: true };
  db.sync(url, opts)
    .on('change', app.onSyncChange)
    .on('paused', app.onSyncPaused)
    .on('error', app.onSyncError);

  // parse the hash
  if (window.location.hash && window.location.hash !== '#') {
    var hash = window.location.hash.replace(/^#/,'');
    if (hash === 'unassigned') {
      app.unAssignedTickets();
    } else if (hash === 'profile') {
      app.profileEditor();
    } else if (hash === 'mytickets') {
      app.myTickets();
    }
  }

}).catch(function(e) {
  // if there's no _local/user document, you're not logged in
  window.location = 'index.html';
});