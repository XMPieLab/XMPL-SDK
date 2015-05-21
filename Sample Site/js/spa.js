'use strict';

var xmpApp = angular.module('spaApp', [
  'ngRoute',
	'spaControllers',
	'xmp.directives',
  	'xmp.controllers',
  	'xmp.services'
])
.config(['$routeProvider',function($routeProvider) {
  $routeProvider
    .when('/:recipientID/edit', {
      controller:'XMPPersonalizedView',
      templateUrl:'editSPA.html'
    })
    .when('/register/', {
      controller:'XMPAnonymousView',
      templateUrl:'registerSPA.html'
    })
    .when('/:recipientID', {
      controller:'XMPPersonalizedView',
      templateUrl:'viewSPA.html'
    })
    .otherwise({
      redirectTo:'/register/'
    });
}])
.config(['xmpResourceProvider', function(inProvider) {
	// 	xmpcfg.access is defined externally at the xmpcfg.js
    inProvider.configure({
      access:xmpcfg.access
    });
}]);

var spaControllers = angular.module('spaControllers', [])
 .controller('main', ['$scope',function ($scope) {

  // nothing!
}]);
