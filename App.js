Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [
            { xtype: 'container', itemId: 'selector_box', padding: 15, layout: { type:'hbox' }, defaults: { padding: 15 }, 
                items: [ 
                    { xtype: 'container', itemId: 'hide_accepted_box'}, 
                    { xtype: 'container', itemId: 'hide_epic_box'}, 
                    { xtype: 'container', itemId: 'tag_box' },
                    { xtype: 'container', itemId: 'tag_exe_box', layout: { type: 'vbox' } },
                    { xtype: 'container', itemId: 'show_group_box' }
                ]
            },
            { xtype: 'container', defaults: { padding: 5 }, items: [
                { xtype: 'container', html: 'Your team delivering stories to other teams', cls: "app_header" },
                { xtype: 'container',  itemId: 'Successors_box'  },
                { xtype: 'container', html: 'Your team receiving stories from other teams', cls: "app_header" },
                { xtype: 'container', itemId: 'Predecessors_box' }
            ]}
        ],
    our_hash: {}, /* key is object id, content is the story from our project associated with that object id */
    other_hash: {}, /* key is object id, content is the story associated with that object id */
    /* THINGS WE CAN'T GET FROM LOOKBACK API: */
    timebox_hash: {}, /* key is object id of iteration or release. Changed both to have EndDate */
    project_hash: {}, /* key is object id of projecs */
    tag_hash: {}, /* key is object id of tags */
    selected_tags: [],
    launch: function() {
        this.first_run = true;
        this._addSelectors();
        this._getBaseData();
    },
    log: function( msg ) {
        var me = this;
//        if ( ( typeof(msg) == "object" ) && ( msg.length ) ) {
//            Ext.Array.each( msg, function( one_msg ) { me.log( one_msg ); } );
//        } else {
            window.console && console.log( new Date(), msg );
//        }
    },
    _addSelectors: function() {
        this._addShowBySchedule();
        this._addAcceptedCheckbox();
        this._addEpicCheckbox();
        this._addTagPicker();
    },
    _addTagPicker: function() {
        var me = this;
        this.down('#tag_box').add(Ext.create('Rally.ui.picker.TagPicker',{
            fieldLabel: "Tag(s):",
            labelAlign: "right",
             allowBlank: true,
            toolTipPreferenceKey: undefined, /* for bug avoidance */
            listeners: {
                selectionchange: function( picker, values ) {
                    this.log( values );
                    var names = [];
                    me.selected_tags = [];
                    Ext.Array.each( values, function(value) { 
                        me.selected_tags.push(value.ObjectID);
                        names.push(value.Name); 
                    } );
                    this.down('#tag_list_box').update( names.join(", " ));
                    this.down('#tag_button').setDisabled(false);
                },
                scope: this
            }
        }));
        this.down('#tag_exe_box').add( { 
            xtype: 'rallybutton', 
            itemId: 'tag_button',
            text: 'Rerun Query with Tags',
            disabled: true,
            handler: function() {
                this.setDisabled(true);
                me._getDependencies(); 
            }
        });
        this.down('#tag_exe_box').add( { xtype: 'container', itemId: 'tag_list_box' });
        
    },
    _addAcceptedCheckbox: function() {
        var me = this;
        this.hide_accepted = true;
        this.down('#hide_accepted_box').add({
            xtype: 'checkbox',
            stateId: 'pxs.dependency.accepted',
            stateful: true,
            stateEvents: ['change'],
            getState: function() {
                me.log( ["saving sate", this.getValue() ]);
                return { value: this.getValue() };
            },
            applyState: function(state) {
                me.log(["applying state", state]);
                if ( state ) {
                    this.setValue(state.value);
                }
            },
            fieldLabel: 'Hide Accepted?',
            labelAlign: "right",
            checked: true,
            listeners: {
                change: function(cb,newValue) {
                    this.hide_accepted = newValue;
                    if ( ! me.first_run ) {
                        /* already have base data at this point */
                         me._getDependencies(); 
                    }
                },
                scope: this
            }
        });
    },
    _addEpicCheckbox: function() {
        this.hide_epic_column = true;
        this.down('#hide_epic_box').add({
            xtype: 'checkbox',
            fieldLabel: 'Hide Epic Columns?',
            labelAlign: "right",
            labelWidth: 125,
            checked: true,
            listeners: {
                change: function( cb, newValue ) {
                    this.hide_epic_column = newValue;
                    this._redrawTables();
                },
                scope: this
            }
        });
    },
    _addShowBySchedule: function() {
        this.selected_schedule = "All";
        this.down('#show_group_box').add({
            xtype: 'radiogroup',
            fieldLabel: 'Show',
            width: 300,
            columns: 3,
            vertical: false,
            labelAlign: "right",
            items: [
                { boxLabel: 'All', name: 'show_sched', inputValue: 'All', checked: true },
                { boxLabel: 'Unscheduled', name:'show_sched', inputValue: 'Unscheduled', width: 100 },
                { boxLabel: 'Late', name: 'show_sched', inputValue: 'Late' }
            ],
            listeners: {
                change: function( radiogroup, newValue ) {
                    this.selected_schedule = newValue.show_sched;
                    this._redrawTables();
                },
                scope: this
            }
        });
    },
    _getBaseData: function() {
        this.tables = {};  /* google display table */
        this.data_tables = {}; /* google data store */
        this.data_views = {}; /* google data view */
        this._getProjects();
    },
    _getDependencies: function() {
        this.showMask("Loading dependencies...");
        // to prevent the checkbox reloading from memory to cause a double load of data
        this.first_run = false;
        this._getOurItems("Successors");
        this._getOurItems("Predecessors");
    },
    _getProjects: function() {
        var me = this;
        this.log("_getProjects");
        this.showMask("Loading project names...");
        Ext.create('Rally.data.WsapiDataStore',{
            context: {project: null},
            autoLoad: true,
            model: 'Project',
            limit: 5000,
            fetch: [ 'ObjectID', 'Name' ],
            filters: { property: "State", operator: "!=", value: "Closed" },
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( data_length );
                    for ( var i=0; i<data_length; i++ ) {
                        me.project_hash[ data[i].get('ObjectID') ] = { Name: data[i].get('Name') };
                    }
                    me._getTags();
                }
            }
        });
    },
    _getTags: function() {
        var me = this;
        this.log("_getTags");
        this.showMask("Loading tags...");
        Ext.create('Rally.data.WsapiDataStore',{
            context: {project: null},
            autoLoad: true,
            model: 'Tag',
            limit: 7500,
            fetch: [ 'ObjectID', 'Name' ],
            filters: { property: "Archived", operator: "=", value: false },
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( data_length );
                    for ( var i=0; i<data_length; i++ ) {
                        me.tag_hash[ data[i].get('ObjectID') ] = { Name: data[i].get('Name') };
                    }
                    me._getTimeboxes();
                }
            }
        });    },
    _getTimeboxes: function() {
        var me = this;
        this.log("_getTimeboxes");
        this.showMask("Loading timeboxes...");
        Ext.create('Rally.data.WsapiDataStore',{
            context: {project: null},
            autoLoad: true,
            model: 'Release',
            limit: 5000,
            fetch: [ 'ObjectID', 'ReleaseDate' ],
            filters: { property: "ObjectID", operator: ">", value: 0 },
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( data_length );
                    for ( var i=0; i<data_length; i++ ) {
                        me.timebox_hash[ data[i].get('ObjectID') ] = { EndDate: data[i].get('ReleaseDate') };
                    }
                    me._getIterations();
                }
            }
        });
    },
    _getIterations: function() {
        var me = this;
        me.log( "_getIterations " );
        
        Ext.create('Rally.data.WsapiDataStore',{
            context: { project: null },
            autoLoad: true,
            limit: 7500,
            model: 'Iteration',
            fetch: [ 'ObjectID', 'EndDate' ],
            filters: { property: "ObjectID", operator: ">", value: 0 },
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( data_length );
                    for ( var i=0; i<data_length; i++ ) {
                        me.timebox_hash[ data[i].get('ObjectID') ] = { EndDate: data[i].get('EndDate') };
                    }
                    me._getDependencies();
                }
            }
        });
    },
    _getOurItems: function( type ) {
        var me  = this;

        
        var filters =  [ 
            {
                property: '__At',
                operator: '=',
                value: 'current'
            },
            {
                property: type,
                operator: '!=',
                value: null
            },
            {
                property: '_ProjectHierarchy',
                operator: '=',
                value: me.getContext().getProject().ObjectID
            }
        ];
        if ( me.hide_accepted ) {
            filters.push( { property: 'ScheduleState', operator: '!=', value: 'Accepted' } );
        }
        if ( me.selected_tags.length > 0 ) {
            filters.push( { property: 'Tags', operator: 'in', value: me.selected_tags } );
        }
        Ext.create('Rally.data.lookback.SnapshotStore',{
            autoLoad: true,
            limit: 1000,
            fetch: ['Name','_ItemHierarchy',type, 'ScheduleState', 'Project', 'Iteration', 'Release', 
                '_UnformattedID', 'Blocked', 'Tags' ],
            hydrate: [ 'ScheduleState','Tags' ],
            filters: filters,
            order: { property: 'ObjectID' },
            listeners: {
                load: function( store, data, success ) {
                    me._createRowPerDependency( type, data );
                }
            }
        });
    },
    _createRowPerDependency: function( type, data ) {
        var me = this;
        me.log( [ "_createRowPerDependency " + type, data.length ] );
        this.showMask("Creating Tables...");
        var number_of_items_with_dependencies = data.length;
        var rows = [];
        
        var direction = "Provides";
        if ( type === "Predecessors" ) {
            direction = "Receives";
        }
        
        for ( var i=0; i<number_of_items_with_dependencies; i++ ) {
            var dependent_ids = data[i].get(type);
            me.our_hash[ data[i].get('ObjectID') ] = data[i].data;
            if ( me.project_hash.hasOwnProperty(data[i].get('Project')) ) {
                var tags = [];
                if ( data[i].get('Tags') && data[i].get('Tags').length > 0 ) {
                    Ext.Array.each( data[i].get('Tags'), function(tag) {
                        if ( me.tag_hash[tag] ) { tags.push( me.tag_hash[tag].Name ); }
                    });
                }
                for ( var j=0; j< dependent_ids.length; j++ ) {
                    rows.push({
                        epic: false,
                        epic_report: "",
                        blocked: data[i].get('Blocked'),
                        object_id: data[i].get('ObjectID'),
                        direction: direction,
                        project: data[i].get('Project'),
                        name: me._getLinkedName(data[i].getData()),
                        schedule_state: data[i].get('ScheduleState'),
                        release: data[i].get('Release'),
                        iteration: data[i].get('Iteration'),
                        iteration_name: "",
                        release_date: null,
                        iteration_date: null,
                        tags: tags.join(' '),
                        other_id: dependent_ids[j],
                        other_project: 'tbd',
                        other_name: 'tbd',
                        other_blocked: false,
                        other_epic: false,
                        other_epic_report: "",
                        other_schedule_state: 'tbd',
                        other_release: null,
                        other_iteration: null,
                        other_release_date: null,
                        other_iteration_date: null
                    });
                }
            }
        }
        me.log( ["Rows:", rows] );
         me.log( ["Data:", data] );
        me._getOurLeaves( type,rows );
    },
/**
 * having trouble when we have more than 300 items to look for at once
 */
    _getOurLeaves: function(type,rows) {
        var me = this;
        me.log("_getLeaves: " + type);     
        var row_length = rows.length;
        var very_long_array = [];
        for ( var i=0;i<row_length;i++ ) {
            very_long_array.push(rows[i].object_id);
        }
        me._doNestedOurLeavesArray( type, rows, very_long_array, 0 );         
    },
    _doNestedOurLeavesArray: function( type, rows, very_long_array, start_index ) {
        var me = this;
        me.log( [ "_doNestedArray", start_index, very_long_array ] );
        var gap = 300;
        var sliced_array = very_long_array.slice(start_index, start_index + gap);
        
        var query = Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_ItemHierarchy', operator: 'in', value: sliced_array
        }).and( Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_TypeHierarchy', operator: '=', value: "HierarchicalRequirement"
        })).and( Ext.create('Rally.data.lookback.QueryFilter',{
            property: 'Children', operator: '=', value: null
        }));
        query = query.and(Ext.create('Rally.data.lookback.QueryFilter',{property: '__At', operator: '=',value: 'current' }));
        Ext.create('Rally.data.lookback.SnapshotStore',{
            autoLoad: true,
            limit: gap,
            fetch: ['Name', '_ItemHierarchy', 'Iteration', 'Release', '_UnformattedID' ],
            filters: query,
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( "load leaves snapshot" );
                    for ( var i=0;i<data_length;i++ ) {
                        // only care if this is the child of one we already got
                        if ( data[i].get('_ItemHierarchy').length > 1 ) {
                            me._findOurItemInHierarchy( data[i] );
                        }
                    }
                    start_index = start_index + gap;
                    if ( start_index < very_long_array.length ) {
                        me._doNestedOurLeavesArray( type, rows, very_long_array, start_index );
                    } else {
                        me._getOtherData(type,rows);
                    }
                }
            }
        });
    },
    _findOurItemInHierarchy: function( bottom_item ) {
        var me = this;
        var bottom_id = bottom_item.get('ObjectID');
        var story_tree = bottom_item.get('_ItemHierarchy');
        Ext.Array.each( story_tree, function(id_in_hierarchy) {
            if ( me.our_hash[ id_in_hierarchy ] && id_in_hierarchy !== bottom_id ) {
                if ( ! me.our_hash[id_in_hierarchy].children ) {
                    me.our_hash[id_in_hierarchy] = me._setAssociatedArraysToEmpty(me.our_hash[id_in_hierarchy]);
                }
                if ( me.our_hash[id_in_hierarchy].children.indexOf(bottom_id) == -1 ) {
                    me.our_hash[id_in_hierarchy].children.push( bottom_id );
                    if ((bottom_item.get('Iteration'))||(bottom_item.get('Release'))) {
                        me.our_hash[id_in_hierarchy].scheduled_children.push(bottom_id);
                        if (bottom_item.get('Iteration')) {
                            me.our_hash[id_in_hierarchy].children_iterations.push(bottom_item.get('Iteration'));
                        }
                        if (bottom_item.get('Release')) {
                            me.our_hash[id_in_hierarchy].children_releases.push(bottom_item.get('Release'));
                        }
                    }
                }
            }
        });
    },
    /**
     * having trouble when we have more than 300 items to look for at once
     */
    _getOtherData: function(type,rows) {
        var me = this;
        me.log("_getOtherData " + type);
//        
        var row_length = rows.length;
        var other_id_array = [];
        for ( var i=0;i<row_length;i++ ) {
            other_id_array.push(rows[i].other_id);   
        }
        
        me._doNestedOtherArray( type, rows, other_id_array, 0 ); 
    },
    _doNestedOtherArray: function( type, rows, other_id_array, start_index ) {
        var me = this;
        var gap = 300;
        var sliced_array = other_id_array.slice(start_index, start_index + gap);
        
        var query = Ext.create('Rally.data.lookback.QueryFilter',{
            property: 'ObjectID', operator: 'in', value: sliced_array
        });
        query = query.and(Ext.create('Rally.data.lookback.QueryFilter',{property: '__At', operator: '=',value: 'current' }));
        Ext.create('Rally.data.lookback.SnapshotStore',{
            autoLoad: true,
            limit: gap,
            fetch: ['Name','_ItemHierarchy', 'ScheduleState', 'Project', 'Iteration', 'Release', 
                '_UnformattedID', 'Blocked' ],
            hydrate: [ 'ScheduleState' ],
            filters: query,
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    for ( var i=0;i<data_length;i++ ) {
                        if ( ! me.other_hash[data[i].get('ObjectID')] ) {
                            me.other_hash[ data[i].get('ObjectID') ] = data[i].data;
                        } else {
                            me.other_hash[ data[i].get('ObjectID')] = Ext.Object.merge(me.other_hash[ data[i].get('ObjectID')], data[i].data );
                        }
                        
                    }

                    start_index = start_index + gap;
                    if ( start_index < other_id_array.length ) {
                        me._doNestedOtherArray( type, rows, other_id_array, start_index );
                    } else {
                        me._getOtherLeaves(type,rows);
                    }
                }
            }
        });
    },
    _findOtherItemInHierarchy: function( bottom_item ) {
        var me = this;
        var bottom_id = bottom_item.get('ObjectID');
        var story_tree = bottom_item.get('_ItemHierarchy');
        Ext.Array.each( story_tree, function(id_in_hierarchy) {
            if ( me.other_hash[ id_in_hierarchy ] && id_in_hierarchy !== bottom_id ) {
                if ( ! me.other_hash[id_in_hierarchy].children ) {
                    me.other_hash[id_in_hierarchy] = me._setAssociatedArraysToEmpty(me.other_hash[id_in_hierarchy]);
                }
                if ( me.other_hash[id_in_hierarchy].children.indexOf(bottom_id) == -1 ) {
                    me.other_hash[id_in_hierarchy].children.push( bottom_id );
                    if ((bottom_item.get('Iteration'))||(bottom_item.get('Release'))) {
                        me.other_hash[id_in_hierarchy].scheduled_children.push(bottom_id);
                        if (bottom_item.get('Iteration')) {
                            me.other_hash[id_in_hierarchy].children_iterations.push(bottom_item.get('Iteration'));
                        }
                        if (bottom_item.get('Release')) {
                            me.other_hash[id_in_hierarchy].children_releases.push(bottom_item.get('Release'));
                        }
                    }
                }
            }
        });
    },
    /**
     * having trouble when we have more than 300 items to look for at once
     */
    _getOtherLeaves: function(type,rows) {
        var me = this;
        me.log("_getLeaves: " + type);     
        var row_length = rows.length;
        var very_long_array = [];
        for ( var i=0;i<row_length;i++ ) {
            very_long_array.push(rows[i].other_id);   
        }
        me._doNestedOtherLeavesArray( type, rows, very_long_array, 0 );         
    },
    _doNestedOtherLeavesArray: function( type, rows, very_long_array, start_index ) {
        var me = this;
        me.log( [ "_doNestedArray", start_index, very_long_array ] );
        var gap = 300;
        var sliced_array = very_long_array.slice(start_index, start_index + gap);
        
        var query = Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_ItemHierarchy', operator: 'in', value: sliced_array
        }).and( Ext.create('Rally.data.lookback.QueryFilter',{
            property: '_TypeHierarchy', operator: '=', value: "HierarchicalRequirement"
        })).and( Ext.create('Rally.data.lookback.QueryFilter',{
            property: 'Children', operator: '=', value: null
        }));
        query = query.and(Ext.create('Rally.data.lookback.QueryFilter',{property: '__At', operator: '=',value: 'current' }));
        Ext.create('Rally.data.lookback.SnapshotStore',{
            autoLoad: true,
            limit: gap,
            fetch: ['Name', '_ItemHierarchy', 'Iteration', 'Release', '_UnformattedID' ],
            filters: query,
            listeners: {
                load: function( store, data, success ) {
                    var data_length = data.length;
                    me.log( "load leaves snapshot" );
                    for ( var i=0;i<data_length;i++ ) {
                        // only care if this is the child of one we already got
                        if ( data[i].get('_ItemHierarchy').length > 1 ) {
                            me._findOtherItemInHierarchy( data[i] );
                        }
                    }
                    start_index = start_index + gap;
                    if ( start_index < very_long_array.length ) {
                        me._doNestedOtherLeavesArray( type, rows, very_long_array, start_index );
                    } else {
                        me._populateRowData(type,rows);
                    }
                }
            }
        });
    },
    _addToTimeboxFilter: function( query, value ) {
        var single_query = Ext.create('Rally.data.QueryFilter', {
           property: 'ObjectID',
           operator: '=',
           value: value
        });
        if ( ! query ) {
            query = single_query;
        } else {
            query = query.or( single_query );
        }
        
        return query;
    },
    _setItemEpicData: function( item ) {
        var me = this;
        if ( ( this.our_hash[ item.object_id ] ) && ( this.our_hash[item.object_id].children )) {
            var total_kids = this.our_hash[item.object_id].children.length;
            var scheduled_kids = this.our_hash[item.object_id].scheduled_children.length;
            item.epic = true;
            var ratio = Math.round( scheduled_kids * 100 / total_kids ) + "%";
            item.epic_report = "(" + scheduled_kids + " of " + total_kids + ") scheduled " + ratio;
                        
            var releases = this.our_hash[item.object_id].children_releases;
            Ext.Array.each( releases, function( release ) {
                if (( me.timebox_hash[release] ) && ( me.timebox_hash[release].EndDate > item.release_date )) {
                    item.release_date = me.timebox_hash[release].EndDate;
                }
            });
            var iterations = this.our_hash[item.object_id].children_iterations;
            Ext.Array.each( iterations, function( iteration ) {
                if (( me.timebox_hash[iteration] ) && ( me.timebox_hash[iteration].EndDate > item.iteration_date )) {
                    item.iteration_date = me.timebox_hash[iteration].EndDate;
                }
            });
        }
        return item;
    },
    _setOtherEpicData: function(item, other) {
        this.log( "_setOtherEpicData" );

        var me = this;
        var releases = other.children_releases;
        Ext.Array.each( releases, function(release) {
            if ((me.timebox_hash[release]) && ( me.timebox_hash[release].EndDate > item.other_release_date)) {
                item.other_release_date = me.timebox_hash[release].EndDate;
            }
        });
        var iterations = other.children_iterations;
        Ext.Array.each( iterations, function(iteration) {
            if ((me.timebox_hash[iteration]) && ( me.timebox_hash[iteration].EndDate > item.other_iteration_date)) {
                item.other_iteration_date = me.timebox_hash[iteration].EndDate;
            }
        });
        return item;
    },
    _populateRowData: function( type, rows ) {
        var me = this;
        this.log( "_populateRowData: " + type );
        var filtered_rows = [];
        var item_length = rows.length;
        for ( var i=0; i<item_length; i++ ) {
            var item = rows[i];
            if (( item.iteration !== "" ) && ( this.timebox_hash[item.iteration] )) {
                item.iteration_date = this.timebox_hash[item.iteration].EndDate;
            }
            if (( item.release !== "" ) && ( this.timebox_hash[item.release] )) {
                item.release_date = this.timebox_hash[item.release].EndDate;
            }
            if (( item.project ) && (this.project_hash[item.project])) {
                item.project = this.project_hash[item.project].Name;
            } else { 
                item.project = "Unknown " + item.project;
            }
            
            item = me._setItemEpicData(item);
                        
            if ((item.other_id) && (this.other_hash[item.other_id])) {
                var other = this.other_hash[item.other_id];
                item.other_name =  me._getLinkedName(other);
                item.other_blocked = other.Blocked;
                item.other_schedule_state = other.ScheduleState;
                var in_open_project = true;
                if ( other.Project ) {
                    if ( this.project_hash[ other.Project ] ) {
                        item.other_project = this.project_hash[other.Project].Name;
                    } else {
                        item.other_project = "Unknown " + other.Project;
                        //this.log( [ "Removed because in a closed project: " + other.Name ] );
                        in_open_project = false;
                    }
                }
                
                if ( in_open_project ) {
                    if ( other.children ) {
                        var total_kids = other.children.length;
                        var scheduled_kids = other.scheduled_children.length;
                        item.other_epic = true;
                        var ratio = Math.round( scheduled_kids * 100 / total_kids ) + "%";
                        item.other_epic_report = "(" + scheduled_kids + " of " + total_kids + ") scheduled " + ratio;
                    }
                    
                    if (( other.Iteration ) && ( this.timebox_hash[other.Iteration] )) {
                        item.other_iteration_date = this.timebox_hash[other.Iteration].EndDate;
                    }
                    if (( other.Release ) && ( this.timebox_hash[other.Release] )) {
                        item.other_release_date = this.timebox_hash[other.Release].EndDate;
                    }
                    item = me._setOtherEpicData(item,other);
                    item = me._setLateColors(item);
                    filtered_rows.push(item);
                } 
            }
        }
        this._makeTable( type, filtered_rows );
    },
    _setLateColors: function(item) {
        item.iteration_out_of_sync = false;
        item.release_out_of_sync = false;
        if ( item.direction === "Provides" ) {
            // item should be earlier than other
            if ( item.iteration_date && item.other_iteration_date && item.iteration_date > item.other_iteration_date ) {
                item.iteration_out_of_sync = true;
            }
            if ( item.release_date && item.other_release_date && item.release_date > item.other_release_date ) {
                item.release_out_of_sync = true;
            }
        } else {
            // item should be after other
            if ( item.iteration_date && item.other_iteration_date && item.iteration_date < item.other_iteration_date ) {
                item.iteration_out_of_sync = true;
            }
            if ( item.release_date && item.other_release_date && item.release_date < item.other_release_date ) {
                item.release_out_of_sync = true;
            }
        }
        return item;
    },
    _makeTable:function( type, rows ) {
        var me = this;
        me.log( "_makeTable: " + type);
        var left_story = "Providing Story";
        var right_story = "Story";
        var left_team = "Team";
        var right_team = "Receiving Project";
        if ( type === "Predecessors" ) {
            left_story = "Receiving Story";
            right_story = "Providing Story";
            right_team = "Providing Project";
        }
        
        this.columns = [
                { id: 'direction', label: 'Your Team...', type: 'string' },
                { id: 'project', label: left_team, type: 'string' },
                { id: 'epic_report', label: 'Epic', type: 'string' },
                { id: 'name', label: left_story, type: 'string' },
                { id: 'schedule_state', label: 'State', type: 'string' },
                { id: 'release_date', label: 'Release Date', type: 'date' },
                { id: 'iteration_date', label: 'Iteration Date', type: 'date' },
                { id: 'other_project', label: right_team, type: 'string' },
                { id: 'other_epic_report', label: 'Epic', type: 'string' },
                { id: 'other_name', label: right_story, type: 'string' },
                { id: 'other_schedule_state', label: 'State', type: 'string' },
                { id: 'other_release_date', label: 'Release Date', type: 'date' },
                { id: 'other_iteration_date', label: 'Iteration Date', type: 'date' },
                { id: 'tags', label: 'Tags', type: 'string' }
            ];
        var data_table = new google.visualization.DataTable({
            cols: me.columns
        });

        // google table is scary because row is pushed as an array of column values
        // that have to be matched to the cols array above (would be nice to have key indexing)

        var number_of_rows = rows.length;
        for ( var i=0; i<number_of_rows; i++ ) {
            var table_row = [];
            Ext.Array.each( me.columns, function(column) {

                // iteration_out_of_sync
                var style = {};
                
                if ( /^schedule_state/.test(column.id) && rows[i].blocked ) {
                    style = { style: 'background-color: #FFCCCC', blocked: true };
                }
                
                if ( /other_schedule_state/.test(column.id) && rows[i].other_blocked ) {
                    style = { style: 'background-color: #FFCCCC', blocked: true };
                }
                
                if ( /Date/.test(column.label) ) {
                    if (! rows[i][column.id] ) {
                        style = { style: 'border: 3px solid yellow', unscheduled: true };
                    } else if (/Iteration/.test(column.label) && rows[i].iteration_out_of_sync ){
                        style = { style: 'background-color: #FFCCCC', late: true };
                    } else if (/Release/.test(column.label) && rows[i].release_out_of_sync ){
                        style = { style: 'background-color: #FFCCCC',late: true };
                    }
                }
                table_row.push( { v: rows[i][column.id], p: style } );

            });
            data_table.addRow(table_row);
        }
        this.data_tables[type] = data_table;
        
        var date_formatter = new google.visualization.DateFormat({formatType:'short'});
        Ext.Array.each(me.columns,function(column,index){
            // date format
            if (/date/.test(column.id)) {
                date_formatter.format(data_table,index);
            }
        });
        var view = new google.visualization.DataView(data_table);
        this.data_views[type] = view;
        
        var outer_box_id = type + '_box';
        var table_box_id = type + '_table_box';
        if ( me.down('#' + table_box_id ) ) { me.down('#'+table_box_id).destroy(); }
        me.down('#'+outer_box_id).add( { xtype: 'container', id: table_box_id });
        
        this.tables[type] = new google.visualization.Table( document.getElementById(table_box_id) );
        //this.tables[type].draw( view, { showRowNumber: false, allowHtml: true } );
        me._redrawTables();
    },
    /**
     * 
     * @param {} which_one The type of the table. Valid values are "Predecessors", "Successors", "Both"
     * 
     */
    _redrawTables: function() {
        this.log( "_redrawTables" );
        var me = this;
        // reset to base data
        var col_array = [];
        for ( var i=0;i<me.columns.length;i++ ) {
            col_array.push(i);
        }
        
        for ( var type in me.data_views ) {
            if ( me.data_views.hasOwnProperty(type) ) {
                me.data_views[type].setColumns(col_array);
                me.data_views[type].setRows(me.data_tables[type].getFilteredRows([{ column: 0, minValue: '' }]));
            }
        }
        
        // to filter items that we already got
        if ( me.selected_schedule === "Unscheduled" ) {
            for ( var type in me.data_views ) {
                if ( me.data_views.hasOwnProperty(type) ) {
                    var filtered_rows = [];
                    var row_indices = me.data_views[type].getFilteredRows([{ column: 0, minValue: '' }]);
                    Ext.Array.each( row_indices, function(row_index) {
                        Ext.Array.each(me.columns,function(column,col_index){
                            if ( me.data_views[type].getProperty(row_index,col_index, "unscheduled")){
                                filtered_rows.push(row_index);
                                return false;
                            }
                        });
                    });
                    me.data_views[type].setRows(filtered_rows);
                }
            }
        } else if ( me.selected_schedule === "Late" ) {
            for ( var type in me.data_views ) {
                if ( me.data_views.hasOwnProperty(type) ) {
                    var filtered_rows = [];
                    var row_indices = me.data_views[type].getFilteredRows([{ column: 0, minValue: '' }]);
                    Ext.Array.each( row_indices, function(row_index) {
                        Ext.Array.each(me.columns,function(column,col_index){
                            if ( me.data_views[type].getProperty(row_index,col_index, "late")){
                                filtered_rows.push(row_index);
                                return false;
                            }
                        });
                    });
                    me.data_views[type].setRows(filtered_rows);
                }
            }
        }
                
        // to hide columns
        if ( me.hide_epic_column ) {
            var columns_to_hide = [];
            Ext.Array.each(me.columns,function(column,col_index) {
                if ( /Epic/.test( column.label) ) {
                    columns_to_hide.push(col_index);
                }
            });
            for ( var type in me.tables ) {
                if ( me.tables.hasOwnProperty(type) ) {
                    me.data_views[type].hideColumns(columns_to_hide);
                }
            }
        }
        
        for ( var type in me.tables ) {
            if ( me.tables.hasOwnProperty(type) ) {
                me.tables[type].draw(me.data_views[type], { showRowNumber: false, allowHtml: true });
            }
        }
    
        this.hideMask();
    },
    _setAssociatedArraysToEmpty: function(item) {
        item.children_releases = [];
        item.children_iterations = [];
        item.scheduled_children = [];
        item.children = [];
        return item;
    },
    showMask: function(msg) {
        if ( this.getEl() ) { 
            this.getEl().unmask();
            this.getEl().mask(msg);
        }
    },
    hideMask: function() {
        this.getEl().unmask();
    },
    _getLinkedName: function(item) {
        this.log( "_getLinkedName" );
        if ( ! item._ref ) {
            item._ref = "/hierarchicalrequirement/" + item.ObjectID;
        }
        if ( ! item.FormattedID ) {
            item.FormattedID = "US" + item._UnformattedID; /* TODO: change this for other customers */
        }
        var url = Rally.util.Navigation.createRallyDetailUrl(item);
        //var url = "/slm/detail/ar/"+item.ObjectID;
        var formatted_string = "<a target='_top' href='" + url + "'>" + item.FormattedID + "</a>: " + item.Name;
        //var formatted_string = "<a target='_blank' href='" + url + "'>" + item.FormattedID + "</a>: " + item.Name;
        return formatted_string;
    }
});
