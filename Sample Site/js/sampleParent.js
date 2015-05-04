'use strict';

// controll
var spaControllers = angular.module('sampleParentController', [])
 .controller('ParentController', ['$scope',function ($scope) {

  $scope.xmp = {};
}]);

// app
var xmpApp = angular.module('indexParentControllerApp', [
	'sampleParentController',
	'xmp.directives',
  	'xmp.controllers',
  	'xmp.services'
]).config(['xmpResourceProvider', function(inProvider) {
	// 	xmpcfg is defined externally at the site.
    inProvider.configure({
      access:xmpcfg.access
    });
}]);


/*
  to run code on application load, use "run" method of application module, pass the injector
*/
xmpApp.run(['$injector',function($injector)
{
  // the following will also work (using element instead of injector) in the below $(document).ready
  new xmpResourceDriver({injector:$injector}).getRecipientADORs('Jane.Jones',null,function(data){$('#txtArea').val(JSON.stringify(data))});

  // can't use controller here though. too early. use $(document).ready instead which seems to work

}]);

// another options is to use 'angular.element(document).ready(function() {'

$(document).ready(function()
{

  // this works here...donnow why realy. can i expect the controller scope to be already available at this point?
  new xmpControllerDriver($('[ng-controller="XMPPersonalizedPage"]')).ready(function(){console.log('controller is ready')});

  $('#btnNonAngularData').click(function()
  {
    /*
      when running code after the application is already loaded, you can use the default setup, or pass the element on which the application is defined
    */

    new xmpResourceDriver().getRecipientADORs(
      new xmpControllerDriver($('[ng-controller="XMPPersonalizedPage"]')
    ).xmp.recipientID,null,function(data){$('#txtArea').val(JSON.stringify(data))});


  });
})