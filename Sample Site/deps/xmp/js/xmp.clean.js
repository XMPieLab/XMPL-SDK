'use strict';

var xmpDirectives = angular.module('xmp.directives',[]);


/*
    async queries replacements
  */
function createAsyncReplacement(element,attrs)
{
  // replacing current GUI with a waiting image
  var elementDimensions = { width: element.width(), height: element.height() };
  element.hide();
  var $imgAlternative = $(document.createElement('div'));
  $imgAlternative.addClass(attrs['xmpAsyncBusyClass'] || 'xmp-busy');
  element.after($imgAlternative);

  // if there's a default with and height to the original element, use them as the object dimensions
  if (attrs['xmpAdaptProgressSize'] != undefined && elementDimensions.width > 0 && elementDimensions.height > 0) {
      $imgAlternative.width(elementDimensions.width);
      $imgAlternative.height(elementDimensions.height);
  }

}

function destroyAsyncReplacement(element)
{
  element.next().remove();
  element.show();

}


/*
	xmp-src -> for image src adors
	xmp-href -> for link href adors
	xmp-class -> for style adors
*/

['src','href','class'].forEach(function(inDirective)
{
	var directive = 'xmp-' + inDirective;
	var camelDirective = 'xmp' + inDirective.substr(0,1).toUpperCase() + inDirective.substr(1);
	xmpDirectives.directive(camelDirective, ['$compile','xmpResource',function($compile,xmpResource)
		{
			return {
			      restrict: 'A',
			      terminal: true, //this setting is important, see explanation below 
			      priority: 1000, //this setting is important, see explanation below
			      compile: function(inElement,inAttributes,inTransclude) {
			        xmpResource.declareRecipientADORsInJQueryElement(inElement);
			        inElement.attr('ng-' + inDirective, inAttributes[camelDirective]);
			        inElement.removeAttr(directive); //remove the attribute to avoid indefinite loop
			        inElement.removeAttr('data-' + directive); //also remove the same attribute with data- prefix in case users specify data-common-things in the html

			        return {
			          pre: function(scope, iElement, iAttrs, controller) {  },
			          post: function(scope, iElement, iAttrs, controller) {  
			            $compile(iElement)(scope);
			          }
			        };
			      }
			 }
		}]
	);
});


/*
	xmp-show directive takes an expression and shows (for true) or hides (for false).
	xmp-show is a simplified version of angularJS ng-show, using the ng-hide class for showing/hiding, however the logic
	used here follows "toBoolean" of XMPie, which is slightly different from ng-show
*/
xmpDirectives.directive('xmpShow', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
			restrict: 'A',
			compile: function(inElement,inAttributes) {
					return function(inScope,inElement,inAttributes) {
						inScope.$watch(inAttributes['xmpShow'], function(inValue)
						{
							if(toBoolean(inValue))
								inAttributes.$removeClass('ng-hide');
							else
								inAttributes.$addClass('ng-hide');
						});
					}
			}

		}
	}]
);

/*
	xmp style boolean, true is anything but empty, 0 or false
*/
function toBoolean(value) {
  if (value && value.length !== 0) {
    value = !(value == '0' || value == 'false');
  } else {
    value = false;
  }
  return value;
}


/*
	xmp-image-asset directive fetches an image asset and places it as the image element. the value should be an ADOR name, qualified
	with recipient or referred recipient.
*/
xmpDirectives.directive('xmpImageAsset', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
			scope:true,

			compile: function(element, attrs) {
				xmpResource.declareRecipientResolvedADORsInExpression(attrs['xmpImageAsset']);
				return  function(scope, iElement, iAttrs, controller)
				{

					// this one here waits for the value
					scope.$watch(attrs['xmpImageAsset'], function(value) {
					     if (!value)
					           return;
						iAttrs.$set('src',xmpResource.getAssetFetchingURL(value));
					});	

					// this one here checks if this ador relies
					// on async value, in which case it shows a progress view
		      		scope.xmpReady(function() {
		      			// check current ADOR status. if in progress...this is async
		      			var adorExpression = attrs['xmpImageAsset'];
		      			var adorStatusExpression = 'xmp.status' + adorExpression.substr(3);
		      			if(scope.$eval(adorStatusExpression) == eADORsLoading)
		      			{
		      				// aha! async. provide propper graphics, and wait till ready
		      				createAsyncReplacement(element,attrs);

							var unregister = scope.$watch(adorStatusExpression, function(value) {
							     if (value == eADORsLoading)
							           return;
			                    destroyAsyncReplacement(element);
			                    unregister();
							});	
		      			}
			       	});						
				};
			}
		};
	}]);


/*
	utility.
	For attributes that contain an ador reference (fully qualified to recipient/referred recipient).
	Waits till recipient/referred recipient can be queried for the ador, and then execute the callback,
	which can either query the value or do something else.
	callback will recieve identity of recipient, ador name, and its current value
*/

function waitForRecipientSourceWithAdorAttribute(xmpResource,inScope,inAttributeValue,inCallback)
{
	/*
		grab ador name from attribute, determine whether recipient or referred.
		should be either or, and just one ADOR
	*/
	var adorIdentity = getADORIdentityFromAttribute(xmpResource,inAttributeValue);

	if(adorIdentity.isRecipient)
	{
		// wait till i got recipient ready, at this point i should have access token
		// and if there's a recipient, also its ID
		var unregister = inScope.$watch('xmp.recipientReady', function(value) {
			if(value)
			{
				unregister();
				// set the src to the image matching recipient ID. make sure i got it, otherwise ignore
				if(inScope.xmp.recipientID)
					inCallback.call(null,adorIdentity.isRecipient,adorIdentity.adorName,inScope.xmp.r[adorIdentity.adorName]);
	        }
	    });						
	}
	else if(Object.keys(referredRecipientADORs).length > 0)
	{
		// referred (made sure it's not nothing). wait on referred
		// recipient ID, which would be a good time to send query on its behalf.
		// at this point access token should already be available
		var unregister = inScope.$watch('xmp.referredID', function(value) {
			if(value)
			{
				unregister();
				inCallback.call(null,adorIdentity.isRecipient,adorIdentity.adorName,inScope.xmp.referredRecipient[adorIdentity.adorName]);
	        }
	    });										
	}	
}

/*
	utility.
	for attributes that value is ador name, get the ador name and determine if from recipient
	or referred recipient
*/
function getADORIdentityFromAttribute(xmpResource,inAttributeValue)
{
	var recipientADORs = {};
	var referredRecipientADORs = {};
	xmpResource.populateRecipientADORsInExpression(inAttributeValue,recipientADORs,referredRecipientADORs);
	
	var isRecipient = Object.keys(recipientADORs).length > 0;

	return {
		isRecipient:isRecipient,
		adorName:(isRecipient ? Object.keys(recipientADORs)[0]:Object.keys(referredRecipientADORs)[0])
	};
}


/*
	xmp-text-asset directive fetches an text asset and places it as the text of the element. the value should be an ADOR name, qualified
	with recipient or referred recipient.
*/


xmpDirectives.directive('xmpTextAsset', ['xmpResource',function(xmpResource)
	{

		return {
			restrict: 'A',
			scope:true,
			compile: function(element, attrs) {
				xmpResource.declareRecipientResolvedADORsInExpression(attrs['xmpTextAsset']);
				return  function(scope, iElement, iAttrs, controller)
				{
					scope.$watch(attrs['xmpTextAsset'], function(value) {
					     if (!value)
					           return;
						xmpResource.fetchAsset(value,
												{},
												function(data, status, headers, config){
													iElement.text(data);
												});					       
					});	
				};
			}
		};
	}]);


/*
	xmp-html-asset directive fetches an html asset and places it as the html of the element. the value should be an ADOR name, qualified
	with recipient or referred recipient.
*/
xmpDirectives.directive('xmpHtmlAsset', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
			scope:true,
			compile: function(element, attrs) {
				xmpResource.declareRecipientResolvedADORsInExpression(attrs['xmpHtmlAsset']);
				return  function(scope, iElement, iAttrs, controller)
				{
					scope.$watch(attrs['xmpHtmlAsset'], function(value) {
					     if (!value)
					           return;
						xmpResource.fetchAsset(value,
												{},
												function(data, status, headers, config){
													iElement.html(data);
												});					       
					});	

				};
			}
		};
	}]);


/*
	xmpRepeat is to be used instead of ngRepeat for creating table ADORs.
	ngRepeat is problematic because the page controller will not be able to analyze its contents
	for any ADORs used in it. this is becasue the page controller is runs at link time
	when any ngRepeat content is removed and replaced with a comment
*/
xmpDirectives.directive('xmpRepeat', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'A',
		      terminal: true, //this setting is important, see explanation below 
		      					// [Gal, 5/4/2014. doing terminal here does not allow "compile" for lower nodes at this time. seems like it's fine without]
		      priority: 1000, //this setting is important, see explanation below
		      compile: function(inElement,inAttributes,inTransclude) {
		        xmpResource.declareRecipientADORsInJQueryElement(inElement);
		        inElement.attr('ng-repeat', inAttributes['xmpRepeat']);
		        inElement.removeAttr("xmp-repeat"); //remove the attribute to avoid indefinite loop
		        inElement.removeAttr("data-xmp-repeat"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html

		        return {
		          pre: function(scope, iElement, iAttrs, controller) {  },
		          post: function(scope, iElement, iAttrs, controller) {  
		            $compile(iElement)(scope);
		          }
		        };
		      }
		 }
	}]
);


/*
	update form directive. used for designating a form that updates the recipient data. Mostly relying on existing ng-submit and ng-model with addition
	of declaring the variables for update on the main controller for getting (via the resource)
*/
xmpDirectives.directive('xmpUpdate', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'A',
		      terminal: true, //this setting is important, see explanation below 
		      priority: 999, //this setting is important, see explanation below
			  scope:true,
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInJQueryElement(element);

		        element.attr('ng-submit', 'updateAdors()');
		        element.removeAttr("xmp-update"); //remove the attribute to avoid indefinite loop
		        element.removeAttr("data-xmp-update"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html

		        return {
		          pre: function (scope, iElement, iAttrs, controller) {  },
		          post: function (scope, iElement, iAttrs, controller) {  
		            $compile(iElement)(scope);
		          }
		        };
		      },
      		  controller: function($scope, $element) {		
      		  		// use main controller defined	update Adors method to implement

      		  		$scope.updateAdors = function(){$scope.updateAdorsForFields($scope.defaultAdorsForSet,$scope)};
      		  }
		 }
	}]
);

/*
	create form directives. creates a new recipient. used in the context of a registration page
*/
xmpDirectives.directive('xmpRegister', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'A',
		      terminal: true, //this setting is important, see explanation below 
		      priority: 999, //this setting is important, see explanation below
			  scope:true,
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInJQueryElement(element);

		        element.attr('ng-submit', 'addRecipient()');
		        element.removeAttr("xmp-register"); //remove the attribute to avoid indefinite loop
		        element.removeAttr("data-xmp-register"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html
		        element.attr('xmp-register-form', 'true'); // mark as registration form for ador collection purposes

		        return {
		          pre: function (scope, iElement, iAttrs, controller) {  },
		          post: function (scope, iElement, iAttrs, controller) {  
		            $compile(iElement)(scope);
		          }
		        };
		      },
      		  controller: function($scope, $element) {		
      		  		$scope.addRecipient = function(){
      		  			$scope.addRecipientForFields($scope.defaultAdorsForSet,$scope)
      		  		};
      		  }
		 }
	}]
);

/*
	add referred recipient form directives, mostly relying on existing ng-submit and ng-model with addition
	of declaring the variables for adding a new recipient that is referred by this recipient

	Note that refer forms retain an isolated scope for XMP so that they may be reset after submit,
	while similar names are used, and higher level scope is updated once submit is carried out
	with the latest referred data
*/
xmpDirectives.directive('xmpRefer', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'A',
		      terminal: true, //this setting is important, see explanation below 
		      priority: 999, //this setting is important, see explanation below
			  scope:true,
		      compile: function(element, attrs) {
				xmpResource.declareRecipientADORsInJQueryElement(element);

		        element.attr('ng-submit', 'addReferredRecipient()');
		        element.removeAttr("xmp-refer"); //remove the attribute to avoid indefinite loop
		        element.removeAttr("data-xmp-refer"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html
		        element.attr('xmp-refer-form', 'true'); // mark as refer form for ador collection purposes

		        return {
		          pre: function (scope, iElement, iAttrs, controller) {  },
		          post: function (scope, iElement, iAttrs, controller) {

	  				// add extra refer adors for retrieve, just for the sake
	  				// of responding after success. scanning now, prior to compile
	  				// so i can get the original attribute values (the ador names)
	  				var recipientDict = {};
	  				scope.referDict = {};
	  				xmpResource.populateRecipientADORsInJQueryElement(element,recipientDict,scope.referDict,false,false,true);


		          	// define isolated xmp instance for referred content, so refered forms may be reset after submit
		          	scope.xmpReady(function()
		          	{
		          		scope.resetXMP();

			          });
		            $compile(iElement)(scope);
		          }
		        };
		      },
      		  controller: function($scope, $element) {		
      		  		// use main controller defined	addReferredRecipientForFields with Adors method to implement
      		  		$scope.resetXMP = function()
      		  		{
			          	var xmpCopy = {};
			          	// shallow copy of xmp in parent scope
						 for (var key in this.xmp) {
						        if (this.xmp.hasOwnProperty(key)) {
						        	xmpCopy[key] = this.xmp[key];
						        }
						      }	
						this.xmp = xmpCopy;		          	
			          	this.xmp.referredRecipient = {};      		  			
      		  		}
      		  		$scope.addReferredRecipient = function(){

      		  				$scope.addReferredRecipientForFields($scope.defaultAdorsForReferredAdd,$scope,Object.keys($scope.referDict));
      		  			};
      		  }
		 }
	}]
);

/*
	xmp-success-triggered-email is a directive for sending email on an action success. such actions are:
	1. page load success (once ADORs are loaded) 
	2. registration form success
	3. update form success
	4. referred recipient success

	The configuration for the email (touchpoint/activity or customizations) is defined either localy or using a shared
	email configuration via the xmp-email tag. When you wish to use a shared definition, the value of the attribute
	should be the ID of the shared email definiton. otherwise the value is assumed to be a touchpoint/activity ID.

	In the latter case, of local definition, the rest of the configucation tags (mostly the customizations attributes) are
	defined in the exact same manner as in an xmpEmail definition.

	Important! If you use both local and shared definitions in the page, make sure that it is clear whether
	the value of the attribute is an ID or a touchpoint ID. If the value will match an ID of a defined shared email configuration it will be used.

	
	Multiple emails sending may be defined by using a comma separated list as this attribute values. note that for local configurations all
	emails will use the same configuration (other than, of course, the touchpoint/email acitivity ID itself)
	
*/

xmpDirectives.directive('xmpSuccessTriggeredEmail', ['xmpResource',function(xmpResource)
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before the form gets evaluated
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInAttributes(attrs);

		      	return  function(scope, iElement, iAttrs, controller)
			    {

				  	if(isActionContainer(iElement,iAttrs))
				  	{
			           	scope.successEmail = {id:iAttrs['xmpSuccessTriggeredEmail'],
			           							customizations:{}};

			           	[
					    	'xmpSubject',
					    	'xmpFrom',
					    	'xmpFromName',
						    'xmpReplyTo',
					    	'xmpTo',
					    	'xmpToName',
					    	'xmpCc',
					    	'xmpCcName',
					    	'xmpBcc',
					    	'xmpBccName'
					    ].forEach(function(inElement)
					    {
							iAttrs.$observe(inElement, function(value) {
						          if (!value)
						             return;
							    	scope.successEmail.customizations[inElement] = value;
						        });		
					    });				  		
					}
					else
					{
						iElement.on('click.xmpSuccessTriggeredEmail',function()
						{
				           	scope.successEmail = {id:iAttrs['xmpSuccessTriggeredEmail'],
				           							customizations:{}};

							[
						    	'xmpSubject',
						    	'xmpFrom',
						    	'xmpFromName',
							    'xmpReplyTo',
						    	'xmpTo',
						    	'xmpToName',
						    	'xmpCc',
						    	'xmpCcName',
						    	'xmpBcc',
						    	'xmpBccName'
						    ].forEach(function(inElement)
						    {
						    	scope.successEmail.customizations[inElement] = iAttrs[inElement];
						    });								
						});
					}
			    };
		      }
		}
	}]

);

function isActionContainer(iElement,iAttrs)
{
	return iElement.is('FORM') || iAttrs['ngController'] == 'XMPPersonalizedPage' || iAttrs['ngController'] == 'XMPAnonymousPage';
}


/*
	xmpSuccessUrl and xmpFailureUrl are used in the context of xmpRegister/xmpUpdate/xmpRefer to designate fail or success urls
*/
xmpDirectives.directive('xmpSuccessUrl', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpSuccessUrl','successURL');
			      }
		      };
	}
);

function activateScopePropertyForFormOrButton(scope,iElement,iAttrs,inAttributeName,inPropertyName)
{
  	if(isActionContainer(iElement,iAttrs))
  	{
		iAttrs.$observe(inAttributeName, function(value) {
		          if (!value)
		             return;
		         scope[inPropertyName] = value;
		        });		
	}
	else
	{
		iElement.on('click.' + inAttributeName,function()
		{
			scope[inPropertyName] = iAttrs[inAttributeName]; 
		});
	}
}

xmpDirectives.directive('xmpFailureUrl', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpFailureUrl','failureURL');
			      }
		      };
	}
);

/*
	xmpSuccessTrackAction and xmpFailureTrackAction are used in the context of xmpRegister/xmpUpdate/xmpRefer to designate tracking recording action for either success or faiulre
*/
xmpDirectives.directive('xmpSuccessTrackAction', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpSuccessTrackAction','successTrackAction');
			      }
		      };
	}
);


xmpDirectives.directive('xmpFailureTrackAction', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpFailureTrackAction','failureTrackAction');
			      }
		      };
	}
);

/*
	xmpSuccessJs/Ng and xmpFailureJs/Ng are javascript code that should be evaluated and run when success/failure is relevant.
	Js vs. Ng exists because of different possible execution contexts. Js executes like a regular javascript function on the global scope.
	Ng executes like an Ng expression in the context of the scope
*/
xmpDirectives.directive('xmpSuccessJs', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, 
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpSuccessJs','successJSAction');
			      }
		      };
	}
);

xmpDirectives.directive('xmpSuccessNg', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, 
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpSuccessNg','successNGAction');
			      }
		      };
	}
);

xmpDirectives.directive('xmpFailureJs', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpFailureJs','failureJSAction');
			      }
		      };
	}
);

xmpDirectives.directive('xmpFailureNg', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, // so it comes before xmpRegister/xmpUpdate/xmpRefer and gets evaluated
		      link: function(scope, iElement, iAttrs, controller)
			      {
			      	activateScopePropertyForFormOrButton(scope,iElement,iAttrs,'xmpFailureNg','failureNGAction');
			      }
		      };
	}
);

/*
	xmpWriteAdor is used in the context of a form that has xmpUpdate, xmpRegister or one that has xmpRefer, to designate a field that is mapped
	to an ADOR. it both gets its value, and will save to it once the form is saved.
	Note that declaring is done in compile to on the global resource, as fetching should be done in common.
	however saving is limited to the form where the modal is placed on (there could be multiple forms), and so collecting is 
	done on the scope (that could be the controller scope)
*/
xmpDirectives.directive('xmpWriteAdor', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'A',
		      terminal: true, //this setting is important, see explanation below
		      priority: 1000, //this setting is important, see explanation below
		      require: '?ngModel',
		      compile: function(inElement,inAttributes,inTransclude) {
		      	var ador = inAttributes['xmpWriteAdor'];
		        inElement.attr('ng-model', ador);
		        inElement.removeAttr("xmp-write-ador"); //remove the attribute to avoid indefinite loop
		        inElement.removeAttr("data-xmp-write-ador"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html

		        return {
		          pre: function(scope, iElement, iAttrs, controller) {  },
		          post: function(scope, iElement, iAttrs, controller) {  
		            $compile(iElement)(scope);

      					if(!scope.defaultAdorsForSet)
      						scope.defaultAdorsForSet = {};
      					if(!scope.defaultAdorsForReferredAdd)
      						scope.defaultAdorsForReferredAdd = {};

      					xmpResource.populateRecipientADORsInExpression(ador,scope.defaultAdorsForSet,scope.defaultAdorsForReferredAdd);
      					if(iAttrs['value'] !== undefined)
      						scope.xmpReady(function(){
                    	iElement.controller('ngModel').$setViewValue(iElement.val())
                  });

		          }
		        };
		      }
		 }
	}]
);

/*
	xmpTrackingPageName, directive for setting the page logical name, for any tracking done in this page
*/
xmpDirectives.directive('xmpTrackingPageName', ['xmpResource','$window',function(xmpResource,$window)
	{
		return {
			restrict: 'A',
			compile: function(inElement,inAttributes,inTransclude) {
				xmpResource.trackingPageName = inAttributes['xmpTrackingPageName'];

				// having tracking page name also signify that the user wishes to track page load and leave...
				// so signify
				xmpResource.trackOnPageLoad = true;

				return function(scope,inElement,inAttributes,controller) {
					var loadedTime = (new Date()).getTime();
					function trackLeave()
					{
						if(loadedTime)
						{
							if(scope.trackingPageName)
							{
					      		xmpResource.trackEvent(
					                'Page Leave',
					                {
					                	sync:true, // sync request is required, so that window unload won't kill the post request
					                  	recipientID:scope.xmp.recipientID,
					                  	properties: xmpResource.addDefaultTrackingParameters({
					                    PageName:scope.trackingPageName,
					                    ActionName:'Page Leave',
					                    ActionParams:(((new Date()).getTime() - loadedTime) / 1000).toString(),
					                  })
					                });
					      	}
					      	else
					      	{
				      		    xmpResource.error('xmpTrackingPageName, leave: cannot track. tracking page name was not assigned '); 
					      	}
				      		loadedTime = null;
						}
					}
					$($window).on('beforeunload',trackLeave);
					scope.$on('$destory',trackLeave);
				}

			}
		}
	}]
);

/*
	xmpTrackingAction, used for tracking the element on which it is placed on. for interactive fields where
	editing is involved (text, selection etc.) onBlur is used as the event to trigger tracking. 
	For others it will be onClick.
	The attribute value defines options separated by  a comma. you may define 0 to 3 parameters, where:
	1. the first one, if defined, is the action name, normally providing either the logical object name or what action it represents (like 'save button').
	2. the second one, if defined, is the event type, like 'Clicked' or 'Navigated'
	3. the third one, if defined, is event parameters. In case of navigation event, for example, you'll want to save the URL

	by default the action name matches the element type. the event type, is also based on the element type (navigation for links, action performed on others),
	parameters are normally empty but the case of 'a' element in which case the href attribute is saved
*/
xmpDirectives.directive('xmpTrackingAction', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
	      	link: function(scope, iElement, iAttrs, controller)
		      {

		      	iElement.on(getHTMLEventForTrackingForElement(iElement) + '.xmpTrackingAction',function()
		      	{
			      	var trackingParameters = iAttrs['xmpTrackingAction'].split(',');
			      	var elementTrackingName = trackingParameters.length > 0 ? trackingParameters[0]:getDefaultTrackingElementName(iElement);
			      	var eventType = trackingParameters.length > 1 ? trackingParameters[1]:getDefaultTrackingEventType(iElement);
			      	var actionParameters = trackingParameters.length > 2 ? trackingParameters[2]:null;

			      	var isAnchor = this.tagName.toLowerCase() == 'a';

		      		if(!actionParameters && isAnchor)
		      			actionParameters = iElement[0].href; // for navigation events, grab the href...and do so now, when the actual value is there
		
					if(scope.trackingPageName)	      	
				      	xmpResource.trackEvent(
				                eventType,
				                {
				                  recipientID:scope.xmp.recipientID, // recipientID should be provided by the controller
				                  properties: xmpResource.addDefaultTrackingParameters({
				                    PageName:scope.trackingPageName,
				                    ActionName:elementTrackingName,
				                    ActionParams:actionParameters
				                  }),
				                  sync:isAnchor // for anchors use sync, to avoid post request being killed by navigation
				                });
				 	else
					    xmpResource.error('xmpTrackingAction: cannot track. tracking page name was not assigned '); 

		      	})
		      }
	      };
	}]
);


function toTitleCase(inString)
{
	if(inString.length == 0)
		return inString;
	else
		return inString.charAt(0).toUpperCase() + inString.substring(1).toLowerCase();
}

function getDefaultTrackingElementName(inJElement)
{
	var result;

    switch (inJElement[0].tagName.toLowerCase()) 
    {
        case 'a': 
        {
        	result = 'Link'; 
        	break;
        }
        case 'input':
        {
            var type = inJElement[0].type;
            if (type) {
                switch (type.toLowerCase()) {
                    case 'button':
                    case 'submit':
                    case 'reset':
                        result = 'Button';
                        break;
                    case 'image':
                    	result = 'Image Button';
                    	break;
                    case 'checkbox':
                    	result = 'Checkbox';
                    	break;
                    case 'radio':
                    	result = 'Radio Button';
                    	break;
                    default:
                    	result = 'Textbox';
                        break;
                }
            }
            break;
        } 
        case "select":
        case "option": 
        	result = "Dropdown"; 
        	break;
        case "textarea": 
        	result = "Textarea"; 
        	break;
        case "img": 
        	result = "Image"; 
        	break;
        case "p": 
        	result = "Paragraph"; 
        	break;
        case "h1": 
        case "h2": 
        case "h3": 
        case "h4": 
        case "h5": 
        case "h6": 
        	result = "Header"; 
        	break;
        case "table": 
        	result = "Table"; 
        	break;
        case "tr": 
        	result = "Table Row"; 
        	break;
        case "td": 
        	result = "Table Cell"; 
        	break;
        case "iframe": 
        	result = "IFrame"; 
        	break;
        default: 
        	result = toTitleCase(inJElement[0].tagName);
    }
	return result;
}

function getDefaultTrackingEventType(inJElement)
{
	return inJElement[0].tagName.toLowerCase() == 'a' ? 'Navigated' : 'Performed Action';
}

function getHTMLEventForTrackingForElement(inJElement)
{
	var result;

    switch (inJElement[0].tagName.toLowerCase()) 
    {
        case "a": 
        {
        	result = "mouseup"; 
        	break;
        }
        case "input":
        {
            var type = inJElement[0].type;
            var isclick = false;
            if (type) {
                switch (type.toLowerCase()) {
                    case "image":
                    case "submit":
                    case "button":
                    case "reset":
                        isclick = true; 
                        break;
                    default:
                        isclick = false; 
                        break;
                }
            }
            result = isclick ? "click" : "change";
            break;
        } 
        case "select":
        case "option": 
        	result = "change"; 
        	break;
        default: 
        	result = "click";
    }
	return result;
}

function runFBActionIfInit(inAppID,inAction)
{
	/*
		initialization facebook behavior, this should be one time code
	*/
	if(!window.fbAsyncInit)
	{
		window.fbAsyncInit = function() {
	        FB.init({
	          appId      : inAppID,
	          xfbml      : true,
	          version    : 'v2.0'
	        });

	        inAction();
		};

		(function(d, s, id){
		 var js, fjs = d.getElementsByTagName(s)[0];
		 if (d.getElementById(id)) {return;}
		 js = d.createElement(s); js.id = id;
		 js.src = "//connect.facebook.net/en_US/sdk.js";
		 fjs.parentNode.insertBefore(js, fjs);
		}(document, 'script', 'facebook-jssdk'));						
	}	
	else
	{
		inAction();
	}
}

function isServerAssetExpression(inItem)
{
	return inItem.substring(0,7) == 'server:'
}

/*
	xmpFacebookShare posts to feed. the post may be based on variables.
	the following variables provide extra data to the post action:
	'xmpAppId',
	'xmpCaption',
	'xmpDescription',
	'xmpTargetLink',
	'xmpName',
	'xmpPictureSrc'
*/
xmpDirectives.directive('xmpFacebookShare', ['$compile','xmpResource',function($compile,xmpResource)
	{
		return {
		      restrict: 'EA',
		      scope:true, // to isolate this xmpFbFeed from other ones. i want to allow using {{ }} in the parameters.
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInAttributes(attrs);

				if(element.is('xmp-facebook-share'))
				{
					/*
						in case it is an element, create the underlying button
					*/
					var btn = $(document.createElement('button'));
					btn.attr('type','button');
					element.append(btn);
					btn.addClass('xmp-facebook-share-btn btn');
				}

				return function(inScope,inElement,inAttributes)
				{

					inElement.on('click.xmpFacebookShare',function(){inScope.postToFacebookFeed()});

					['xmpAppid',
					'xmpCaption',
					'xmpDescription',
					'xmpTargetLink',
					'xmpName',
					'xmpThumbnail',
					].forEach(function(inElement)
					{
						inAttributes.$observe(inElement, function(value) {
						          if (!value)
						             return;
						         	inScope[inElement] = value;
						        });		
					});

					
					inScope.$watch(inAttributes['xmpThumbnailAsset'],function(value)
					{
						if(!value)
							return;
						inScope.xmpThumbnailAsset = xmpResource.getAssetFetchingURL(value);
					});

					inScope.postToFacebookFeed = function()
					{
						var self = this;


						runFBActionIfInit(
							this.xmpAppid,
							function()
							{

								xmpResource.debug('xmpFacebookShare,postToFacebookFeed: running facebook ui action with app id =',self.xmpAppid);

		        				FB.ui({
		        					method: 'feed', 
		        					link: self.xmpTargetLink, 
		        					name: self.xmpName, 
		        					caption: self.xmpCaption,
		        					description: self.xmpDescription, 
		        					picture: self.xmpThumbnailAsset ? self.xmpThumbnailAsset: self.xmpThumbnail
		        				},function(){});
							});
	        		}


				};
		      }
		 }
	}]
);


/*
	xmpTwitterShare provide tweeter share button.
	You can customize the tweet using the "data" attributes defined by the twitter button, as defined
	in https://dev.twitter.com/docs/tweet-button. it is OK to have dynamic field controlling the attributes
	values. use xmpSharedText and xmpUrl to determine the content of the tweet
*/
xmpDirectives.directive('xmpTwitterShare', ['$compile','$window','xmpResource',function($compile,$window,xmpResource)
	{
		return {
		      restrict: 'EA',
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInAttributes(attrs);

		      	/*
					build initial specifiers for twitter. DONT ADD THE CLASS YET
		      	*/
		      	var isElement = element.is('xmp-twitter-share');
		      	var theElement;
				if(isElement)
				{
					theElement = $(document.createElement('a'));
					theElement.append('Tweet');
					element.append(theElement);
				}
				else
					theElement = element;
				theElement.attr('href', 'https://twitter.com/share');
				theElement.attr('data-url', attrs['xmpUrl']);
				theElement.attr('data-text', attrs['xmpSharedText']);

				return function(inScope,inElement,inAttributes)
				{
					// follow up on updates on the interesting attributes to set them on the 
					// matching attributes for twitter
				   	[
				    	{key:'xmpUrl',value:'data-url'},
				    	{key:'xmpSharedText',value:'data-text'}
				    ].forEach(function(inObject)
				    {
						inAttributes.$observe(inObject.key, function(value) {
								// any change in value should trigger rebuild of the twitter button according to the new
								// element
								theElement.attr(inObject.value,value);

					        });	
				    });



				    // create the twitter button only when data is ready, so the internal data for the tweet is already resolved
					inScope.xmpReady(function() {
							$window.setTimeout(function()
							{
								theElement.addClass('twitter-share-button');
								if(typeof twttr !== 'undefined')
							    	twttr.widgets.load();
							    // note that if at this point twttr is not yet loaded, it will be loaded later
							    // and resolve this button
					        },0);
				        }
				    );						

					// register the handler script [twttr]
					(function(d,s,id){
						var js,
						fjs=d.getElementsByTagName(s)[0];
						if(!d.getElementById(id)){
							js=d.createElement(s);
							js.id=id;
							js.src="https://platform.twitter.com/widgets.js";
							fjs.parentNode.insertBefore(js,fjs);
						}
					}(document,"script","twitter-wjs"));					

				};
		      }
		 }
	}]
);

/*
	xmpAsync directive is used for fetching ADORs asynchronusly, as opposed to the regular usage of ADORs that are fetched
	as the controller is loaded.

	each ADOR defined by another attribute in an element that has xmp-async attribute will be fetched not by the regular mechanism.
	Rather a request is sent per xmp-async element for the ADORs that are included in its attributes (both refer and recipient).

	Important! xmp-async is not recursive! children elements will have their ADORs fetched synchronously. if you want to wait for children too,
	have them use xmp-async as well.

	You can control the class name for the loading object (it'll be a div) by setting the data-xmp-async-progress-class attribute to the class name
	of your desire. this allows you some cusotmization of the waiting code (include complete removal). the size of the progress element is dynamic, per 
	the size of the element that has xmp-async. you can make it static by setting data-xmp-async-static-progress-size attribute. [then you'll be able to control
	the size via the class defined in xmp-async-busy-class or the default one xmp-busy]

	Note! if you want to have adors that are not collected initially, in order to do something similar to what's done with xmp-async, use the attribute
	xmpAsyncCustom on the relevant element. any element with xmpAsyncCustom, its attributes won't be queried for ADORs. you will need to later
	fetch them using a similar mechanism to what's done in this directive implementation (use xmpResource.getRecipientADORs passing async true).
*/

var eADORsLoading = 'loading';
var eADORsLoaded = 'loaded';
var eADORsFailed = 'failed';
var eJobDone = 0;
var eJobInProgress = 1;
var eJobFailed = 2;


function loadAsync(scope,inElement,inAttributes,controller,xmpResource,$window)
{
	createAsyncReplacement(inElement,inAttributes);

    // call method to execute the actual async get process, with waiting etc.
    runAsyncGet(xmpResource,
                $window,
                scope,
                scope.asyncRecipientADORs,
                scope.asyncReferredRecipientADORs,
                function () {
                   destroyAsyncReplacement(inElement);
                });	
}

xmpDirectives.directive('xmpAsync', ['xmpResource','$window',function(xmpResource,$window,$injector)
	{
        return {
            restrict: 'A',
            scope:true,
            link: function (scope, inElement, inAttributes, controller) {
			    // collect ADORs for async jobs [note that collection is done on the element, to pick up the template and not evaluated attributes]. collect both for recipient and referred recipient
			    scope.asyncRecipientADORs = {};
			    scope.asyncReferredRecipientADORs = {};
			    $.each(inElement[0].attributes, function (i, attrib) {
			        xmpResource.populateRecipientADORsInExpression(attrib.value, scope.asyncRecipientADORs, scope.asyncReferredRecipientADORs);
			    });


            	loadAsync(scope,inElement,inAttributes,controller,xmpResource,$window);
            	scope.$on('xmpRecipientUpdate',function(){loadAsync(scope,inElement,inAttributes,controller,xmpResource,$window)});

            }
        };
	}]);


function loadAsyncAdor(scope,inElement,inAttributes,controller,xmpResource,$window)
{
    // call method to execute the actual async get process, with waiting etc.
    runAsyncGet(xmpResource,
                $window,
                scope,
                scope.asyncRecipientADORs,
                scope.asyncReferredRecipientADORs);

}

xmpDirectives.directive('xmpLoadAsyncAdor', ['xmpResource','$window',function(xmpResource,$window,$injector)
	{
		return {
		    restrict: 'A',
		    scope:true,
		    link: function (scope, inElement, inAttributes, controller) {

		        // collect ADORs for async jobs. collect both for recipient and referred recipient
			    scope.asyncRecipientADORs = {};
			    scope.asyncReferredRecipientADORs = {};
		        xmpResource.populateRecipientADORsInExpression(inAttributes['xmpLoadAsyncAdor'], scope.asyncRecipientADORs, scope.asyncReferredRecipientADORs);
            	
            	loadAsyncAdor(scope,inElement,inAttributes,controller,xmpResource,$window);
            	scope.$on('xmpRecipientUpdate',function(){loadAsyncAdor(scope,inElement,inAttributes,controller,xmpResource,$window)});
		    }

		};
	}]);

function runAsyncGet(xmpResource,$window,scope,inRecipientADORsSet,inReferredRecipientADORsSet,onSuccessCB)
{
    function getResolvedAdorsForAdorsList(inIsRecipient,adorsList)
  	{
  		var targetQueryDict = inIsRecipient ? scope.defaultAdorsForResolve : scope.defaultAdorsForReferredResolve;
  		var result = [];

  		adorsList.forEach(function(inADOR)
  		{
  			if(targetQueryDict[inADOR])
  				result.push(inADOR);
  		});

  		return result;
  	}

    var recipientADORsFields = Object.keys(inRecipientADORsSet);
    var referredRecipientADORsFields = Object.keys(inReferredRecipientADORsSet);

    var asyncJobs = {};

    // Now to carry the actual retrieve we need to wait for server token to become avialable as well as recipient and/or referred recipient IDs, 
    // something which is carried out by a login method and other inits at the top level controllers. 
    // At that point the recipient ID and referred recipient ID should be resolved. waiting for that stage is 
    // done in the simplest manner, by waiting for the recipient and 
    // referred recipient initial resolution to be ready.
	scope.xmpReady(function() {


            // run async job for recipient ADORs [check out this code reuse. amazing. the @#$@# won't let me forEach directly, so i have to store in a var. dahhh]
            var recipientRequestsDescriptors = [{ adorsList: recipientADORsFields, objectName: 'r', recipientID: scope.xmp.recipientID },
                    { adorsList: referredRecipientADORsFields, objectName: 'referredRecipent', recipientID: scope.xmp.referredID }];
            var totalJobs = recipientRequestsDescriptors[0].adorsList.length == 0 ? 0:1 +
            				recipientRequestsDescriptors[1].adorsList.length == 0 ? 0:1 ;

            // initiate jobs
            recipientRequestsDescriptors.forEach(function (inParameters) {
                if (inParameters.adorsList.length == 0 || !inParameters.recipientID)
                    return;

                xmpResource.debug('runAsyncGet: starting async query. recipient id =',inParameters.recipientID,'adors=',inParameters.adorsList);

                setupLoadStatus(scope.xmp, inParameters.objectName, inParameters.adorsList, eADORsLoading);
                xmpResource.getRecipientADORs(inParameters.recipientID, {
                    adors: inParameters.adorsList,
                    resolved:getResolvedAdorsForAdorsList(inParameters.objectName == 'r',inParameters.adorsList),
                    async: true
                }).$promise.then(function (result) {
                	
                	asyncJobs[result.jobID] = {
                		keys:inParameters.adorsList,
                		target:inParameters.objectName,
                		initStatus:result.status,
                		initValues:result.values
                	};

		            // use scope method to wait on them
                	if(Object.keys(asyncJobs).length == totalJobs)
			            scope.trackAsyncJobs(asyncJobs,onSuccessCB);

                });
            });


        });
}

/*
	xmppdfondemand ELEMENT directive for creating a clickable GUI so that when clicked a personalized document generation
	occurs for the page recipient. There is a default GUI but you can create one of your own. When creating your own GUI you may use the following
	scope properties to determine the GUI:

	status = "initial", "completed","in progress", "failed" 
	documentID = the document ID to generate
	buttonTitle = title to provide for button (if you have a button in your GUI)
	downloadURL - in case of success (status == 0) will have the URL that can be used for downloading the ready document
	errorMessage - error message in case of failure, as provided by the server (status = 2)

*/

var kPDFOnDemandStatuses = ['initial','completed','in progress','failed'];
function stringOfStatus(inStatus)
{
	return kPDFOnDemandStatuses[inStatus+1];
}

xmpDirectives.directive('xmppdfondemand', ['xmpResource','$window','$compile',function(xmpResource,$window,$compile)
	{
		return {
			restrict: 'E',
			scope:true,
	      	compile: function(inElement,inAttributes,inTransclude) {

	      		// element is empty, place default GUI
	      		if(inElement.html().search(/[^\s\\]/) == -1)
	      		{
	      			inElement.append('<xmpdefaultgenerateview/>');
	      			return null;
			        /* Gal 27/9/2014. seems like we don't need an extra compilation here. the element gets intepreted anyways.
			        	if i do compile, then it will do the click twice. suspicious but gonna turn off right now.
			        	return {
			          pre: function(scope, iElement, iAttrs, controller) {  },
			          post: function(scope, iElement, iAttrs, controller) {  
			            //$compile(iElement)(scope);
			          }};*/
	        	}
	        	else
	        		return null;
	        },
      		controller: function($scope, $element) {			

      			$scope.status = stringOfStatus(-1);
      			$scope.documentID = $element.attr('xmp-document-ID') || $element.attr('data-xmp-document-ID');
      			$scope.buttonTitle = $element.attr('xmp-button-title') || $element.attr('data-xmp-button-title');

      			function documentGenerationJobWait(inRetriesCount)
      			{
      				xmpResource.debug('xmppdfondemand,documentGenerationJobWait job',$scope.jobID,'still in progress. retries count =',inRetriesCount);
					xmpResource.getGenerationJobStatus({jobID:$scope.jobID}).$promise.then(function(result)
					{
						$scope.status = stringOfStatus(result.status);
						if(result.status == eJobInProgress)
						{
							// try again, raise retries count [yeah, currently i'm doing nothing with it]
				        	window.setTimeout(function(){
				        		documentGenerationJobWait(inRetriesCount+1);
					        },$scope.asyncWaitTime);
						}
						else
						{
							documentGenerationJobDone(result);
						}
					},
					function()
					{
						$scope.status = stringOfStatus(eJobFailed);
						$scope.downloadURL = null;
						$scope.errorMessage = 'xmppdfondemand,generateDocument: request failure';
	      				xmpResource.error('xmppdfondemand,generateDocument: request failure');
					});
      			}

      			function documentGenerationJobDone(inResult)
      			{
					if(inResult.status == eJobDone)
					{
	      				xmpResource.debug('xmppdfondemand,documentGenerationJobDone succesfuly finished document generation job. file id for download =',inResult.generatedFileID);
						$scope.downloadURL = xmpResource.getGeneratedFileFetchingURL({fileID:inResult.generatedFileID});
						$scope.errorMessage = null;
					}
					else // eJobFailure
					{
						$scope.downloadURL = null;
						$scope.errorMessage = inResult.errorMessage;
	      				xmpResource.error('xmppdfondemand,documentGenerationJobDone failed document generation. message =',inResult.errorMessage);
					}      				
      			}

      			$scope.generateDocument = function() {
      				$scope.status = stringOfStatus(eJobInProgress);
      				xmpResource.debug('xmppdfondemand,generateDocument: starting document generation job for recipient',$scope.xmp.recipientID,'and document id',$scope.documentID);

					xmpResource.startGenerationJob(
									$scope.documentID,
									{recipientID:$scope.xmp.recipientID}).$promise.then(function(result)
								{
									$scope.status = stringOfStatus(result.status);
									$scope.jobID = result.jobID;
				      				xmpResource.debug('xmppdfondemand,generateDocument: job id is',$scope.jobID);
									if(result.status == eJobInProgress)
										documentGenerationJobWait(0);
									else
										documentGenerationJobDone(result);
								},
								function()
								{
									$scope.status = stringOfStatus(eJobFailed);
									$scope.downloadURL = null;
									$scope.errorMessage = 'xmppdfondemand,generateDocument: request failure';
				      				xmpResource.error('xmppdfondemand,generateDocument: request failure');
								});	
      			}
			},
		};
	}]
);

/*
	internal directive, used to display the default GUI for PDF download
*/
xmpDirectives.directive('xmpdefaultgenerateview',function()
	{
		return {
			replace:true,
			restrict: 'E',
			require: '^xmppdfondemand',
			template:   '<div class="xmp-default-generate-view"><span class="xmp-button-on-demand"><button type="button" class="btn" ng-click="generateDocument()" ng-class="{\'xmp-hide\':status==\'in progress\'}">{{buttonTitle}}</button>' + 
						'<span class="xmp-busy-on-demand" ng-show="status==\'in progress\'"></span></span>' +
						'<iframe style="display:none" width="1" height="1" frameborder="0" ng-src="{{downloadURL | trustAsResourceUrl}}"></iframe>' +
						'<span ng-show="status==\'failed\'">An error occured, please try again later</span></div>'
		};
	}
);

/*
	xmpEmail directives [elements!] defines a configuration for an email that can be sent later
	via xmp-success-triggered-email tag (and possibly others later). The tag is used when the same
	email is used from multiple locations in the page and such sharing is desirable.

	two mandatory attributes exist:
	1. id - to provide Id for the email for others to refer
	2. xmp-touchpoint - provide the touch point ID for the email activity

	There may be other attribtues used for the sake of providing cusotmizations:

   	xmp-subject
   	xmp-from
   	xmp-from-name
   	xmp-reply-to
   	xmp-to
   	xmp-to-name
   	xmp-cc
   	xmp-cc-name
   	xmp-bcc
   	xmp-bcc-name
*/
xmpDirectives.directive('xmpEmail',['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'E',
			compile: function(element, attrs) {
				xmpResource.declareRecipientADORsInAttributes(attrs);

				return  function(scope, iElement, iAttrs, controller)
				{
					var theID = iAttrs['id'];
		         	if(!xmpResource.emails)
		         		xmpResource.emails = {};
					xmpResource.emails[theID] = {touchpoint:iAttrs['xmpTouchpoint'],
				   										customizations:{}};

				   	[
				    	'xmpSubject',
				    	'xmpFrom',
				    	'xmpFromName',
					    'xmpReplyTo',
				    	'xmpTo',
				    	'xmpToName',
				    	'xmpCc',
				    	'xmpCcName',
				    	'xmpBcc',
				    	'xmpBccName'
				    ].forEach(function(inElement)
				    {
						iAttrs.$observe(inElement, function(value) {
					          if (!value)
					             return;
						    	xmpResource.emails[theID].customizations[inElement] = value;
					        });		
				    });

				};
			}			
		};
	}]
);

/*

	xmpUnsubscribe directive should be placed on a clickable content, so that when click is executed
	it can change the email subscription status for the current recipient. it's value (can be true or false)
	sets the status. the parameters controlling subscription are passed via the URL of teh web page
	and their description is out of scope of this library, but rather an internal XMPie method
*/
xmpDirectives.directive('xmpUnsubscribe',['xmpResource',function(xmpResource)
{
		return {
		      restrict: 'A',
		      link: function(scope, inElement, iAttrs, controller) {
					inElement.on('click.xmpUnsubscribe',function(){
						// recipient ID will be derived from parent controller
			      		xmpResource.changeUnsubscribeStatus(scope.xmp.recipientID,iAttrs['xmpUnsubscribe'] != 'false' ? true:false);
					});

		      }
		 };
}]
);

/*
	xmpCloak attribute can be placed on any element controlled by the xmpie controllers, to hide it until the initial recipient/referred recipient load is 
	finished. this is good if you want to wait for avoiding showing the angular templates. it's quite similar to the ngCloak directive provided by
	angular, only that it waits till end of load. matching css rule hides the content.

*/

xmpDirectives.directive('xmpCloak', function()
	{
		return {
		      restrict: 'A',
		      priority: 1000, //this setting is important, see explanation below
		      link: function(scope, inElement, iAttrs, controller) {
	      		scope.xmpReady(function() {
				        	inElement.removeAttr("xmp-cloak"); //remove the attribute to avoid indefinite loop
				        	inElement.removeAttr("data-xmp-cloak"); //also remove the same attribute with data- prefix in case users specify data-common-things in the html
				       });						

		        }
		      };
	}
);


/*
	xmpLoadAdorTimeout can be used on a page to configure timeout in particular for this page
	[normally, use the xmpResource configuration provider for this purpose]
*/
xmpDirectives.directive('xmpLoadAdorTimeout', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
			compile: function(inElement,inAttributes,inTransclude) {
				xmpResource.timeout = parseInt(inAttributes['xmpLoadAdorTimeout'],10);
			}

		}
	}]
);


xmpDirectives.directive('xmpNoCaching', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
			compile: function(inElement,inAttributes,inTransclude) {
				xmpResource.dontCacheGets = (inAttributes['xmpNoCaching'] != undefined) &&  inAttributes['xmpNoCaching'] != 'false';
			}

		}
	}]
);

/*
	xmpClickedTriggeredEmail can be placed on a clickable item to trigger and email send on click.
	properties are the same as in xmpSuccesstriggeredemail
*/

xmpDirectives.directive('xmpClickedTriggeredEmail', ['xmpResource',function(xmpResource)
	{
		return {
		      restrict: 'A',
		      compile: function(element, attrs) {
		      	xmpResource.declareRecipientADORsInAttributes(attrs);

		      	return  function(scope, iElement, iAttrs, controller)
			    {
					iElement.on('click.xmpClickedTriggeredEmail',function()
					{
			           	var successEmail = {id:iAttrs['xmpClickedTriggeredEmail'],
			           							customizations:{}};

						[
					    	'xmpSubject',
					    	'xmpFrom',
					    	'xmpFromName',
						    'xmpReplyTo',
					    	'xmpTo',
					    	'xmpToName',
					    	'xmpCc',
					    	'xmpCcName',
					    	'xmpBcc',
					    	'xmpBccName'
					    ].forEach(function(inElement)
					    {
					    	successEmail.customizations[inElement] = iAttrs[inElement];
					    });	

					    // now send the email!
					    scope.sendEmailToRecipient(successEmail);

					});
			    };
		      }
		}
	}]

);

function getRecipientADORName(xmpResource,inExpression)
{
	var dictRecipient = {};
	var dictReferred = {};
	xmpResource.populateRecipientADORsInExpression(inExpression,dictRecipient,dictReferred);

	return Object.keys(dictRecipient)[0];
}

function getServerAssetExpression(inItem)
{
	return inItem.substring(7);
}


/*
	xmpUpdateOnPageLoad are elements that trigger a save on the recipient values on page load
*/
xmpDirectives.directive('xmpUpdateOnPageLoad', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'E',
			compile: function(inElement,inAttributes) {

						if(!xmpResource.adorsToSetOnLoad)
							xmpResource.adorsToSetOnLoad = {};

						var adorName = getRecipientADORName(xmpResource,inAttributes['xmpAdor']);
						if(!adorName)
							return null;

						xmpResource.adorsToSetOnLoad[adorName] = inAttributes['xmpValue'];

						return function(inScope,inElement,inAttributes)
						{
							var unregister = inAttributes.$observe('xmpValue', function(value) {
								if(!xmpResource.adorsToSetOnLoad)
								{
									/*
										this means that the saving action already occured and we can finish listening
									*/
									unregister();
									return;
								}

								xmpResource.adorsToSetOnLoad[adorName] = value;
							});		
						};
			}

		}
	}]
);

/*
	xmp-laod-ador directive allows you to declare an ADOR name so that the controller will fetch it.
	The ADORs are being accumulated on xmpResource.defaultAdorsForGet (which may need to be created).
	Use this when using ADORs for general purpose and you want to make sure that the ADORs are retrieved
	value is a comma separated list of ADOR names (if you are using r.XXXX, put r.XXXX)

	most of the times declaring ADORs is not required as the xmpie defined controllers scan for ADOR names
	in the HTML at load time. however, if for some reason they are invisible - load them.
*/
xmpDirectives.directive('xmpLoadAdor', ['xmpResource',function(xmpResource)
	{
		return {
			restrict: 'A',
			compile: function(inElement,inAttributes,inTransclude) {
				xmpResource.declareRecipientADORsInExpression(inAttributes['xmpLoadAdor']);
			}

		}
	}]
);


/*
	Turn off a default error view. see below in xmpDefaultErrorNode
*/
xmpDirectives.directive('xmpTurnOffDefaultError',['xmpResource',function(xmpResource)
{
	return {
		restrict: 'A',
		compile: function(inElement,inAttributes,inTransclude)
		{
			xmpResource.turnOffDefaultErrorPage = (inAttributes['xmpTurnOffDefaultError'] != undefined) &&  inAttributes['xmpTurnOffDefaultError'] != 'false';
		}
	}
}]);


function isLoginError(inHTTPError)
{
	return inHTTPError.config.method == 'POST' && inHTTPError.config.url.match(/\/login$/);
}

function isRecipientGetError(inHTTPError)
{
	return inHTTPError.config.method == 'GET' && inHTTPError.config.url.match(/\/resource\/[^/]*\/recipients\/[^/]*$/);	
}

function isRecipientUpdateError(inHTTPError)
{
	return inHTTPError.config.method == 'PUT' && inHTTPError.config.url.match(/\/resource\/[^/]*\/recipients\/[^/]*$/);		
}

function isRecipientCreateError(inHTTPError)
{
	return inHTTPError.config.method == 'POST' && inHTTPError.config.url.match(/\/resource\/[^/]*\/recipients$/);		
}


function getSpecificErrorDetails(inHTTPError)
{
	if(isRecipientGetError(inHTTPError))
	{
		return 'Cannot get recipient data. The most probable reason is that the recipient ID is not available in the database (check the page URL for the recipient ID), or that the server is not responsive (down)';
	}
	else if(isLoginError(inHTTPError))
	{
		return 'Cannot login to XMPL server. The most probable reason is that the server is not responsive (down)';
	}
	else if(isRecipientUpdateError(inHTTPError))
	{
		return 'Cannot update recipient data. The most probable reason is that the recipient ID is not available in the database (check the page URL for the recipient ID), or that the server is not responsive (down)';
	}
	else if(isRecipientCreateError(inHTTPError))
	{
		return 'Cannot create a new recipient. The most probable reason is that the server is not responsive (down)';
	}
	else
		return '';
}

/*
	Internally used directive to implement a default error page.
	In case of loading or form submit error, the node will cover all the controller area
	and show the HTTP error, much like server pages showing the error display by default for debug purposes.

	The node behavior is dependent upon a definition of errorReason in the xmp scope. This is controlled
	by the controllers, who place there a non null value in any interesting error - where the page should kill itself

	Note that this page will not be shown if the relevant activity defines a xmp-failure-url redirect, in which case
	the redirect will be peformed and the error node won't be shown.
	Also - to turn off the error node simply place xmp-turn-off-default-error on the ng-controller node 
*/
xmpDirectives.directive('xmpDefaultErrorNode',[function()
	{
		return {
			restrict: 'C',
			template:   '<div ng-if="xmp.errorReason" class="xmp-default-error-display">' +
						'<h1>XMPL error</h1>' + 
						'<p>An error occurred while performing a call to XMPL Server. <br />' +
						'This is a generic view that appears during such errors, providing details about the error. <br />' + 
						'If you want it not to appear in case of error add the attribute <code>xmp-turn-off-default-error</code> to the element containing the <code>ng-controller</code> attribute.   </p>' +
						'<h2>Error details</h2>' +
						'<p>{{specificErrorDetails(xmp.errorReason)}}</p>' +
						'<h2>HTTP error data</h2>' +
						'<h3>Source:</h3>' +
						'<ul>' +
						'<li><strong>url:</strong> {{xmp.errorReason.config.url}}</li>' +
						'<li ng-show="xmp.errorReason.config.params"><strong>query string parameters:</strong>' +
						'<code>' +
						'{{xmp.errorReason.config.params}}' +
						'</code></li>' +
						'<li ng-show="xmp.errorReason.config.data"><strong>body:</strong> ' +
						'<code>' +
						'{{xmp.errorReason.config.data}}' +
						'</code></li>' +
						'</ul>' +
						'<h3>Result:</h3>' +
						'<ul>' +
						'<li><strong>status:</strong> {{xmp.errorReason.status}}</li>' +
						'<li><strong>data:</strong> {{xmp.errorReason.data}}</li>' +
						'</ul>' +
						'<h2>HTTP object</h2>' +
						'<p>{{xmp.errorReason}}</p>' +
						'</div>',
			link: function($scope, $element, inAttributes)
			{
				$scope.specificErrorDetails = function(reason)
				{
					return getSpecificErrorDetails(reason);
				}

				// top setup width & height i have to use javascript...
				$scope.$watch('xmp.errorReason', function(inValue)
				{
					var controllerElement = $element.parent();

					$internalMain = $element.children().first();
			      	$internalMain.width(controllerElement.width());
			      	$internalMain.css('min-height',controllerElement.height());
			      	$internalMain.offset(controllerElement.offset());
				});
			}
		};
	}]
);
'use strict';
var xmpControllers = angular.module('xmp.controllers', ['ngCookies'])

xmpControllers.filter('trustAsResourceUrl', ['$sce', function($sce) {
    return function(val) {
        return $sce.trustAsResourceUrl(val);
    };
}]);
 
function changeLocation($scope,$location,url, forceReload) {
    $scope = $scope || angular.element(document).scope();

    if(forceReload || $scope.$$phase) {
        window.location = url;
    }
    else 
    {
      $location.path(url);
      $scope.$apply();
    }
  };

/*
  Controller for a page where the visitor is an exisiting recipient.
  meaning - recipientID is assumed an personalized page appears
*/

var eADORsLoading = 'loading';
var eADORsLoaded = 'loaded';
var eADORsFailed = 'failed';
var eJobDone = 0;
var eJobInProgress = 1;
var eJobFailed = 2;

function initAsyncConfig($scope,$injector) {
    try {
        var asyncConfig = $injector.get('appConfig')();
        if (asyncConfig.asyncAttempts !== undefined)
            $scope.asyncAttempts = asyncConfig.asyncAttempts;
        if (asyncConfig.asyncWaitTime !== undefined)
            $scope.asyncWaitTime = asyncConfig.asyncWaitTime;
    } catch (e) {
    }
}


function personalizedViewController($scope,
                                  $location,
                                  $window,
                                  $injector,
                                  $cookies,
                                  $parse,
                                  xmpResource,
                                  declareADORsCB,
                                  setupDefaultErrorPageCB) {
  
  /*
    setup functionality common to anonymous visitor and recipient visitor pages
  */
  commonControllersSetup($scope,
                          $location,
                          $window,
                          $injector,
                          $cookies,
                          $parse,
                          xmpResource,
                          declareADORsCB,
                          setupDefaultErrorPageCB);

  /*
    setup recipient retrieve [differ case of redirection per xmpRedirect and the general case of regular retrieve]
  */
  var defaultADORs = Object.keys($scope.defaultAdorsForGet);

  /*
    retrieve recipient data
  */
  var loginResult;
  var withADORsRetrieve = defaultADORs.length > 0;
  if(withADORsRetrieve)
  {

    setupLoadStatus($scope.xmp,'r',defaultADORs,eADORsLoading);
    // do login with ador retrieve
    xmpResource.debug('personalizedViewController: running login+retrieve. service token cookie =',$cookies.xmpServiceToken,'recipient id cookie =',$cookies.xmpRecipientID, 'recipient fields =',defaultADORs);

    loginResult = xmpResource.getRecipientADORs(null,
                  {
                    adors:defaultADORs,
                    resolved:Object.keys($scope.defaultAdorsForResolve),
                    login:{
                      cached: {
                        serviceToken:$cookies.xmpServiceToken,
                        recipientID:$cookies.xmpRecipientID
                      }
                    }
                  });
  }
  else
  {
    xmpResource.debug('personalizedViewController: running login only (no retrieve). service token cookie =',$cookies.xmpServiceToken,'recipient id cookie =',$cookies.xmpRecipientID);

    // do login without retrieve
    loginResult = xmpResource.login($cookies.xmpServiceToken,$cookies.xmpRecipientID,true);
  }

  loginResult.$promise.then(
      function(result)
      {
          // success
          if(withADORsRetrieve)
          {
            $scope.xmp.recipientID = result.login.recipientID;

            var resultAnalysis = analyzeGetADORSResponse(result.result,'r');
            $scope.xmp.r = result.result;
            setupLoadStatus($scope.xmp,'r',resultAnalysis.readyADORs,eADORsLoaded);
            $scope.trackAsyncJobs(resultAnalysis.asyncJobs); 
          }
          else
          {
            $scope.xmp.recipientID = result.recipientID;
            $scope.xmp.r = {}; 
          }

          xmpResource.debug('personalizedViewController: success in login/load. Recipient ID is ', $scope.xmp.recipientID);

          recipientReady($scope);

          // save in cookies
          $cookies.xmpServiceToken = xmpResource.access.serviceToken;
          $cookies.xmpRecipientID = $scope.xmp.recipientID;

          // setup referred recipient data
          referredRecipientSetup($scope,$location,$cookies,xmpResource);

        // use setTimeout to allow values to update themselves post recipient retrieve
        $window.setTimeout(function()
          {
            saveADORsOnLoad($scope,xmpResource);
          },0);  
      },
      function(reason)
      {

        // failure
        setupLoadStatus($scope.xmp,'r',defaultADORs,eADORsFailed);
        recipientError($scope,reason);
        referredRecipientError($scope);    
      }
  );

  function saveADORsOnLoad(scope,xmpResoruce)
  {
    if(!xmpResource.adorsToSetOnLoad  || Object.keys(xmpResource.adorsToSetOnLoad).length == 0)
      return;


      xmpResource.debug('saveADORsOnLoad: saving adors on page load, adors:',xmpResource.adorsToSetOnLoad);

      xmpResource.saveRecipientADORs(scope.xmp.recipientID,
                                      xmpResource.adorsToSetOnLoad);
      xmpResource.adorsToSetOnLoad = null; // null, so won't affect spa
  } 
}

function createDefaultErrorNode($element,$compile,$scope)
{
  var $newNode = $(document.createElement('div')).addClass('xmp-default-error-node');
  $element.append($newNode);
  $compile($newNode)($scope);
}

xmpControllers.controller('XMPPersonalizedPage', ['$scope',
                                                '$element',
                                                '$location',
                                                '$window',
                                                '$injector',
                                                '$cookies',
                                                '$parse',
                                                '$compile',
                                                'xmpResource',
                                                function($scope,
                                                        $element,
                                                        $location,
                                                        $window,
                                                        $injector,
                                                        $cookies,
                                                        $parse,
                                                        $compile,
                                                        xmpResource)
                                                {
                                                  personalizedViewController($scope,
                                                                              $location,
                                                                              $window,
                                                                              $injector,
                                                                              $cookies,
                                                                              $parse,
                                                                              xmpResource,
                                                                              function()
                                                                              {
                                                                                  xmpResource.declareRecipientADORsInJQueryElement($element);
                                                                                  xmpResource.debug('XMPPersonalizedPage: Scanning ADORs on $element');
                                                                              },
                                                                              function()
                                                                              {
                                                                                createDefaultErrorNode($element,$compile,$scope);
                                                                                xmpResource.debug('XMPPersonalizedPage: creating default error element');
                                                                              }
                                                                              );
                                                }]);


xmpControllers.controller('XMPPersonalizedView', ['$scope',
                                                '$location',
                                                '$window',
                                                '$injector',
                                                '$cookies',
                                                '$parse',
                                                '$rootElement',
                                                'xmpResource',
                                                function($scope,
                                                        $location,
                                                        $window,
                                                        $injector,
                                                        $cookies,
                                                        $parse,
                                                        $rootElement,
                                                        xmpResource)
                                                {
                                                  personalizedViewController($scope,
                                                                              $location,
                                                                              $window,
                                                                              $injector,
                                                                              $cookies,
                                                                              $parse,
                                                                              xmpResource,
                                                                              function()
                                                                              {
                                                                                // allow adors scanning in case used in the context of a view
                                                                                var $ngView = $rootElement.find('[ng-view]');
                                                                                if($ngView.length > 0)
                                                                                {
                                                                                  xmpResource.declareRecipientADORsInJQueryElement($ngView);
                                                                                  xmpResource.debug('XMPPersonalizedView: Scanning ADORs on $ngView');
                                                                                }
                                                                                else
                                                                                  xmpResource.debug('XMPPersonalizedView: $ngView not found, not scanning for ADORs'); 
                                                                              },
                                                                              function()
                                                                              {

                                                                              }

                                                                              );
                                                }]);

function getFailureCBForRecipientSubmit($location,$parse,scope, xmpResource, inPostActionParameters) {
    return function (reason) {

        // track failure
        if (inPostActionParameters.failureTrackAction)
        {
            xmpResource.debug('onRecipientSubmitSuccess: tracking on failure');
            trackSimpleAction(scope, xmpResource, inPostActionParameters.failureTrackAction, inPostActionParameters.failureURL);
        }


        /*
            run javascript
        */
        if(inPostActionParameters.failureJSAction)
        {
          xmpResource.debug('onRecipientSubmitSuccess: running global javascript command on success:',inPostActionParameters.failureJSAction);
          eval(inPostActionParameters.failureJSAction);
        }

        if(inPostActionParameters.failureNGAction)
        {
          xmpResource.debug('onRecipientSubmitSuccess: running scope method on failure:',inPostActionParameters.failureNGAction);
          $parse(inPostActionParameters.failureNGAction)(scope);
        }


        // redirect to failure url
        if (inPostActionParameters.failureURL)
        {
            xmpResource.debug('onRecipientSubmitSuccess: redirecting to another URL on failure:',inPostActionParameters.failureURL);
            changeLocation(scope, $location, inPostActionParameters.failureURL);
        }
        else if(scope.showDefaultFailurePage)
        {
          scope.transitToFailureView(reason);
        }
    }
}

function onRecipientSubmitSuccess($window, $location, $parse,xmpResource, scope, inPostActionParameters,inEmailRecipientID,inDoneCB) {
    $window.setTimeout(function () {
        // timeout is set, to wait till all gets reevaluated per above modal changes. probably there's a better method for that.

        /*
            send email on success. using emailAcitivityToSendOnUpdateSuccess as email descriptor [email defaults to recipient, unless defined otherwise]
        */
        if (inPostActionParameters.successEmail)
        {
            xmpResource.debug('onRecipientSubmitSuccess: sending success email');
            sendEmail(xmpResource, inPostActionParameters.successEmail, inEmailRecipientID ? inEmailRecipientID:scope.xmp.recipientID, inPostActionParameters.successURL);
        }

        if (inPostActionParameters.successTrackAction)
        {
            xmpResource.debug('onRecipientSubmitSuccess: tracking on success');
            trackSimpleAction(scope, xmpResource, inPostActionParameters.successTrackAction, inPostActionParameters.successURL);
        }

        /*
            run javascript
        */
        if(inPostActionParameters.successJSAction)
        {
          xmpResource.debug('onRecipientSubmitSuccess: running global javascript command on success:',inPostActionParameters.successJSAction);
          eval(inPostActionParameters.successJSAction);
        }

        if(inPostActionParameters.successNGAction)
        {
          xmpResource.debug('onRecipientSubmitSuccess: running scope method on success:',inPostActionParameters.successNGAction);
          $parse(inPostActionParameters.successNGAction)(scope);
        }


        /*
            move to another page on success
        */
        if (inPostActionParameters.successURL)
        {
            xmpResource.debug('onRecipientSubmitSuccess: redirecting to another URL on success:',inPostActionParameters.successURL);
            changeLocation(scope, $location, inPostActionParameters.successURL, true); // enforce force reload, because might be in resolution phase and want a real reload for a new page
        }

        /*
            callback for client, to carry out when all is done.
            note that this is done after possible redirect...so in case of redirect it's not gonna happen.
            currently usages are cool with it, and it is preferred to avoid extra processing if not necessary.
            when not...i'll have to add another option.
        */
        if(inDoneCB)
        {
          xmpResource.debug('onRecipientSubmitSuccess: running callback on success');
          inDoneCB();
        }
    }, 0);
}

function setupLoadStatus(inXMPObject,inMember,inAdorsList,inStatus)
{
  if(!inXMPObject.status[inMember])
      inXMPObject.status[inMember] = {};
  var target= inXMPObject.status[inMember];

  inAdorsList.forEach(function(inADOR)
  {
    target[inADOR] = inStatus;
  });

  if(inStatus == eADORsFailed && !inXMPObject.status.adorfailure)
    inXMPObject.status.adorfailure = true;
}

function sendEmail(xmpResource,inEmailReference,inRecipientID,inSync)
{
  inEmailReference.id.split(',').forEach(function(inEmailID)
  {
    var touchpointID;
    var customizations;
    var emailConfig = xmpResource.emails ? xmpResource.emails[inEmailID]:null;
    if(emailConfig)
    {
      touchpointID = emailConfig.touchpoint;
      customizations = emailConfig.customizations;
    }
    else
    {
      touchpointID = inEmailID;
      customizations = inEmailReference.customizations;
    }

    xmpResource.debug('sendEmail: sending email. touchpoint ID = ',touchpointID,'customizations = ',customizations);

    xmpResource.sendEmail(
        touchpointID,
        {
          sync:inSync, 
          recipientID:inRecipientID,
          customizations:customizations
        });
   });
}

function trackSimpleAction(scope,xmpResource,inAction,inSync)
{
  if(scope.trackingPageName)
  {
    xmpResource.trackEvent(
          inAction,
          {
              sync:inSync,
              recipientID:scope.xmp.recipientID,
              properties: xmpResource.addDefaultTrackingParameters({
              PageName:scope.trackingPageName,
              ActionName:inAction,
            })
          });
  }
  else
  {
    xmpResource.error('trackSimpleAction: cannot track. tracking page name was not assigned '); 
  }
}

function recipientReady($scope)
{
    $scope.xmp.recipientReady = true;
    broadcastIfReady($scope);
}

function recipientError($scope,reason)
{
    $scope.xmp.recipientReady = true;
    $scope.xmp.recipientFailed = true;
    $scope.xmp.recipientFailureReason = reason;
    broadcastIfReady($scope);
}


/*
  analyse good response from get adors,
  prepare a list of ADORs that are ready, and a list of async jobs that started
  return both so that async jobs can be waited on, and ready adors declared as ready
*/
function analyzeGetADORSResponse(result,inTarget)
{

  var readyADORs = [];
  var asyncJobs = {};

  for(var ador in result)
  {
      if(result[ador] && result[ador].uImage)
      {
        if(!asyncJobs[result[ador].jobID])
        {
          asyncJobs[result[ador].jobID] = {
            keys: [],
            target: inTarget
          };
        }
        asyncJobs[result[ador].jobID].keys.push(ador);
        result[ador] = null;
      }
      else
      {
        readyADORs.push(ador);
      }
  }

  return {
    readyADORs:readyADORs,
    asyncJobs:asyncJobs
  }        
}

function referredRecipientSetup($scope,$location,$cookies,xmpResource)
{
  /*
    call this after having setup the login phase, so can use the service token
  */

  $scope.xmp.referredID  = $cookies.xmpReferredID;
  if($scope.xmp.referredID)
  {
    // get referred recipient fields. differ case
    // of redirect, to default adors getting
    var referredDefaultADORs = Object.keys(xmpResource.defaultAdorsForReferredGet);

    if(referredDefaultADORs.length > 0)
    {
      xmpResource.debug('referredRecipientSetup: retrieving referred recipient data. id = ',$scope.xmp.referredID,' fields = ',referredDefaultADORs);

      setupLoadStatus($scope.xmp,'referredRecipient',referredDefaultADORs,eADORsLoading);
      var result = xmpResource.getRecipientADORs($scope.xmp.referredID,{adors:referredDefaultADORs,resolved:xmpResource.defaultAdorsForReferredResolve});

      // use then statement to setup status of adors fetching when ready or failed

      result.$promise.then(function()
      {
        var resultAnalysis = analyzeGetADORSResponse(result,'referredRecipient');
        $scope.xmp.referredRecipient = result;
        setupLoadStatus($scope.xmp,'referredRecipient',resultAnalysis.readyADORs,eADORsLoaded);
        $scope.trackAsyncJobs(resultAnalysis.asyncJobs); 
        $scope.xmp.referredRecipientReady = true;
        broadcastIfReady($scope);
      },
      function(reason)
      {
        $scope.xmp.referredRecipient = {};
        setupLoadStatus($scope.xmp,'referredRecipient',referredDefaultADORs,eADORsFailed);
        referredRecipientError($scope,reason);
      });



    }
    else
    {
      // initialize an empty object
      $scope.xmp.referredRecipient = {};
      $scope.xmp.referredRecipientReady = true;
      broadcastIfReady($scope);
    }
  }
  else
  {
    // initialize an empty object
    $scope.xmp.referredRecipient = {};
    $scope.xmp.referredRecipientReady = true;
    broadcastIfReady($scope);
  }

  // reset items placed on xmpResource to affect contorller loading
  $scope.defaultAdorsForReferredGet = xmpResource.defaultAdorsForReferredGet; // save adors list in a scope parameter to allow others to get it
  $scope.defaultAdorsForReferredResolve = xmpResource.defaultAdorsForReferredResolve;
  xmpResource.defaultAdorsForReferredGet = null;
  xmpResource.defaultAdorsForReferredResolve = null;
}

function referredRecipientError($scope,reason)
{
  $scope.xmp.referredRecipientReady = true;
  $scope.xmp.referredRecipientFailed = true;
  $scope.xmp.referredRecipientFailureReason = reason;
  broadcastIfReady($scope);
}


function broadcastIfReady($scope)
{
  if($scope.xmp.referredRecipientReady && $scope.xmp.recipientReady)
  {
      $scope.xmp.ready = true;
      $scope.$root.$broadcast('xmpReady');
      $scope.xmpResource.debug('broadcastIfReady: ready');
  }
} 

function commonControllersSetup($scope,
                                $location,
                                $window,
                                $injector,
                                $cookies,
                                $parse,
                                xmpResource,
                                declareADORsCB,
                                setupDefaultErrorPageCB)
{

$scope.xmpResource = xmpResource;

xmpResource.createDefaultRetrieveDictionaries();

// initialize page tracking parameter if required (doing before commonControllerSetup , so will take on that once it arrives)
// the property is initialized by using the xmpTrackingPageName directive
if (xmpResource.trackOnPageLoad)
    $scope.successTrackAction = "Page Visit";


// initialize default error handler
$scope.showDefaultFailurePage = !xmpResource.turnOffDefaultErrorPage;
if($scope.showDefaultFailurePage)
  setupDefaultErrorPageCB();

// simple method to call method when we're sure the object is ready (after token retrieve and initial data retrieve)
$scope.xmpReady = function(cb)
  {
    if($scope.xmp && $scope.xmp.ready)
      cb.call(null);
    else
      $scope.$on('xmpReady',function(){cb.call(null);});
  }  

  // create baseline xmp object for all xmpie activities,
  // allow sharing objects by checking if one already exists
  if($scope.xmp)
  {
    xmpResource.debug('commonControllersSetup: sharing xmp object with higher level scope');

    if($scope.xmp.status)
    {
      $scope.xmp.status.adorFailure = false;
    }
    else
    {
      $scope.xmp.status = {
        adorfailure: false
      };
    }
  }
  else
  {
    xmpResource.debug('commonControllersSetup: creating independent xmp object');

    $scope.xmp = {
      status:{
        adorfailure: false
      }
    };
  }

  // callback for declaring ADORs. called after scope base xmp object is created
  declareADORsCB.call();

  // setup page tracking name
  $scope.trackingPageName = xmpResource.trackingPageName;

  // initiate wait for completing of retrieves to execute regular success/failure activities and tracking on lod
  $scope.xmpReady(function() {

      if($scope.xmp.recipientFailed || $scope.xmp.referredRecipientFailed)
      {
          getFailureCBForRecipientSubmit($location,$parse,$scope,xmpResource,$scope)($scope.xmp.recipientFailureReason || $scope.xmp.referredRecipientFailureReason);
          xmpResource.error('commonControllersSetup: initial load failed');
      }
      else
      {
          xmpResource.debug('commonControllersSetup: initial load succesful');
          onRecipientSubmitSuccess($window, $location,$parse,xmpResource, $scope, $scope);        
      }
  });    

  // reset items placed on xmpResource for the purpose of the controller setup [important for SPA implementations]
  xmpResource.turnOffDefaultErrorPage = null;
  xmpResource.trackOnPageLoad = null;
  xmpResource.trackingPageName = null;
  $scope.defaultAdorsForGet = xmpResource.defaultAdorsForGet; //save in scope for other usages [form retrieves]
  $scope.defaultAdorsForResolve = xmpResource.defaultAdorsForResolve;
  xmpResource.defaultAdorsForGet = null;
  xmpResource.defaultAdorsForResolve = null;

  /*
    General method that shows error in the area of the controller, detailing the failed request
  */
  $scope.transitToFailureView = function(reason)
  {
    xmpResource.debug('running default transition to error view',reason);
    $scope.xmp.errorReason = reason;
  }

  /*
    update adors for a recipient page is used to update the visitor values,
    inFields is a dictionary where the keys are ADORs to update (it's a dict cause i'm using it as a set)

    note that update is common for both anonymous and personalized controller.
    This is to allow post registration updates
  */
  $scope.updateAdorsForFields = function(inFields,inPostActionParameters)
  {
    /*
      call to updateAdors is facilitated by using the xmpUpdate directive. put it on a form.
      you may use xmpSuccessUrl and xmpFailureUrl attributes to define expressions that will serve
      as the transition URLs in either success or failure (respectively)
    */
    if(inFields)
    {
      var savedADORs = {};

      /*
        inFields should be populated by xmpModal directives on the page
      */
      for(var key in inFields)
        savedADORs[key] = $scope.xmp.r[key];

      xmpResource.debug('updateAdorsForFields: updating adors for recipient. adors =',savedADORs);

      var getADORs = Object.keys($scope.defaultAdorsForGet);

      setupLoadStatus($scope.xmp,'r',getADORs,eADORsLoading);
      var resolvedADORs = Object.keys($scope.defaultAdorsForResolve);


      xmpResource.saveRecipientADORs($scope.xmp.recipientID,
                                      savedADORs,
                                      {retrieveADORs:getADORs.length > 0 ? getADORs:undefined,
                                        resolvedADORs:resolvedADORs.length > 0 ? resolvedADORs:undefined}).$promise.then(function (result)
        {
          xmpResource.debug('updateAdorsForFields: success in updating adors');

          var resultAnalysis = analyzeGetADORSResponse(result,'r');
          resultAnalysis.readyADORs.forEach(function(key)
          {
              $scope.xmp.r[key] = result[key];
          });
          setupLoadStatus($scope.xmp,'r',resultAnalysis.readyADORs,eADORsLoaded);
          $scope.trackAsyncJobs(resultAnalysis.asyncJobs); 
          $scope.$broadcast('xmpRecipientUpdate');

          onRecipientSubmitSuccess($window, $location,$parse,xmpResource, $scope, inPostActionParameters);
        },
        getFailureCBForRecipientSubmit($location,$parse,$scope,xmpResource,inPostActionParameters));
    }
  }


  // add common methods to scope
  $scope.sendEmailToRecipient = function(inEmailReference)
  {
    sendEmail(xmpResource, inEmailReference, $scope.xmp.recipientID);          
  }

  $scope.sendEmailToReferredRecipient = function(inEmailReference)
  {
    sendEmail(xmpResource, inEmailReference, $scope.xmp.referredID);          
  }


  $scope.addReferredRecipientForFields = function(inFields,inActionParameters,inExtraADORsForRetrieve)
  {
    /*
      call to addReferredRecipientForFields is facilitated by using the xmpRefer directive. the referred recipient is added.
      upon return from post request the added recipient ID and requested fields are added to the model, so dependent
      elements can be re-evaluated. 
      Then an optional email send occurs, possibly with newly updated recipient fields.
    */
    if(inFields)
    {
      var savedADORs = {};

      /*
        defaultAdorsForReferredAdd should be populated by xmpModal directives on the page
      */
      for(var key in inFields)
        savedADORs[key] = inActionParameters.xmp.referredRecipient[key];

      /*
        make post call for adding recipient. pass adors to set, and adors to be returned, for later email.
      */

      // adors retrieved per the default adors scanned 
      // in the initial page load. those are ADORs that are outside of
      // any refer forms
      var referredDefaultADORs = Object.keys($scope.defaultAdorsForReferredGet);
      var referredDefaultADORsResolved =  Object.keys($scope.defaultAdorsForReferredResolve);

      // extra adors introduced as input parameter
      // used by calling refer form to introduce adors that are required
      // only for the form success operations (like sending email per referred recipient)
      // For all other aspects the adors in the the refer form are ignored, so as not to confuse
      // with a previously refered person (for which a cookie may still contain the id, or just the previous
      // state of refer in a spa application)
      if(inExtraADORsForRetrieve)
      {
        inExtraADORsForRetrieve.forEach(function(key)
        {
          referredDefaultADORs.push(key);
        });
      }

      setupLoadStatus($scope.xmp,'referredRecipient',referredDefaultADORs,eADORsLoading);

      xmpResource.debug('addReferredRecipientForFields: adding referred recipient. saved data =',savedADORs,'. data to retrieve = ',referredDefaultADORs);

      xmpResource.addRecipient({
                  adors:savedADORs,
                  retrieveADORs:referredDefaultADORs,
                  resolvedADORs:referredDefaultADORsResolved
      }).$promise.then(function(result)
      {

        // recipient ID and Data is
        $scope.xmp.referredID = result.recipientID;
        var resultAnalysis = analyzeGetADORSResponse(result.values,'referredRecipient');
        resultAnalysis.readyADORs.forEach(function(key)
        {
            $scope.xmp.referredRecipient[key] = result.values[key];
        });
        setupLoadStatus($scope.xmp,'referredRecipient',resultAnalysis.readyADORs,eADORsLoaded);
        $scope.trackAsyncJobs(resultAnalysis.asyncJobs); 


        // place new recipient id in cookie, so can retrieve later in next page
        $cookies.xmpReferredID = $scope.xmp.referredID;

        // remove xmp from scope, so can access retrieved higher level content for things like
        // email sending and actions
        delete inActionParameters.xmp;

        xmpResource.debug('addReferredRecipientForFields: success in adding referred recipient. referred recipient id = ', $scope.xmp.referredID);

        onRecipientSubmitSuccess($window, $location,$parse,xmpResource, $scope, inActionParameters,$scope.xmp.referredID,function()
                                  {
                                      // reset xmp in form scope
                                      inActionParameters.resetXMP();
                                  });

      },
      getFailureCBForRecipientSubmit($location,$parse,$scope, xmpResource, inActionParameters));

    }
  }
  

  // function getters for lower controllers direct access


  $scope.getXmp = function()
  {
    return $scope.xmp;
  }

  $scope.getRecipientData = function()
  {
    return $scope.xmp.r;
  }

  $scope.getReferredRecipientData = function()
  {
    return $scope.xmp.referredRecipient;
  }

  $scope.getRecipientID = function()
  {
    return $scope.xmp.recipientID;
  }

  $scope.getReferredRecipientID = function()
  {
    return $scope.xmp.referredID;
  }


  // initialize asynchrnous config
  $scope.asyncWaitTime = 1500;
  $scope.asyncAttempts = 100;
  initAsyncConfig($scope,$injector);

  /*
    defining generic method for tracking async jobs. used both by uImage internal algorithm
    and directives.

    asyncJobs is a dictionary containing async jobs that were already started. Each key is a job id
    and the value is a dictionary describing a job. 
    it has three entries:

      keys, which is the arrays of adors requested for this job.
      target, which is either 'r' or 'referredRecipient', depending on which recipient the keys/adors refer to.
      initStatus, may be optionally provided, to allow the initial state to be other than "in progress" (sometimes planning jobs as async may still return fast).
      in that case, there will also be 'initValues' which will provide the values


    if all jobs are finished, the onDoneCB is called
  */
  $scope.trackAsyncJobs = function(asyncJobs,onDoneCB)
  {
      if(Object.keys(asyncJobs).length == 0)
      {
        if(onDoneCB)
          onDoneCB();
        return;
      }

      function asyncWait(inAllJobs, inJobID, inRetriesCount) {
          xmpResource.debug('trackAsyncJobs,asyncWait: job with id =',inJobID,'still in progress, current retry count is',inRetriesCount);
          xmpResource.getRecipientQueryStatus({ jobID: inJobID }).$promise.then(function (result) {
              if (result.status == eJobInProgress) {
                  if (inRetriesCount == $scope.asyncAttempts) // timeout, consider as failure
                  {
                      asyncJobDone(inAllJobs, inJobID,eJobFailed);
                      xmpResource.error('trackAsyncJobs,asyncWait: retry timeout reached. failing');
                  }
                  else
                      $window.setTimeout(function () { // try again, raise retries count
                          asyncWait(inAllJobs, inJobID, inRetriesCount + 1);
                      }, $scope.asyncWaitTime);
              }
              else // success!
                  asyncJobDone(inAllJobs, inJobID, result.status, result.values);
          });
      }

      function asyncJobDone(inAllJobs, inJobID,inStatus, inValues) {

          // an sync job, actually only refers to a single recipient. you can deduce which is it by checking which entry exists
          // and if both  (can happen), check which has a keys array of more than 0 length. only one can have it
          // and it will be the right recipient request
          var targetDictName = inAllJobs[inJobID].target;

          if (inStatus == eJobDone) 
          {
              // if successful fill target dictionary with values. note that values will relate to either recipient, or referred recipient.
              // can be determined per the name of the dictionary
              xmpResource.debug('trackAsyncJobs,asyncJobDone: finished query succesfuly');

              if(Object.keys(inValues).length == 1 && inAllJobs[inJobID].keys.length == 1 &&
                  Object.keys(inValues)[0] != inAllJobs[inJobID].keys[0])
              {
              // uImage may return a wrong ADOR name, as it does not know it, so check a special case where inValues has only 1 value,
              // and it's key is not the same as the same single value in .keys. if that's the case prefer the .keys
              // name when setting the ADOR
                $scope.xmp[targetDictName][inAllJobs[inJobID].keys[0]] = inValues[Object.keys(inValues)[0]];
              }
              else
              {
                // other cases
                for (var v in inValues)
                    $scope.xmp[targetDictName][v] = inValues[v];
              }
              setupLoadStatus($scope.xmp, targetDictName, inAllJobs[inJobID].keys, eADORsLoaded);
          }
          else {
              // failed!
              setupLoadStatus($scope.xmp, targetDictName, inAllJobs[inJobID].keys, eADORsFailed);
              xmpResource.error('trackAsyncJobs,asyncJobDone: failued to finish query');
          }

          // mark this request as done
          inAllJobs[inJobID].status = true;

          // check if all requests are resolved
          var allResolved = true;
          for (var job in inAllJobs)
              allResolved = allResolved && inAllJobs[job].status;

          // check if done
          if (allResolved) {
              // run callback, provide final statuses on jobs through struct
              if(onDoneCB)
                onDoneCB(inAllJobs);
          }
      }   

      // mark all as not finished yet
      for(var asyncJobID in asyncJobs)
          asyncJobs[asyncJobID].status = false; 

      // initiate the waiting
      for(var asyncJobID in asyncJobs)
      { 
          if(asyncJobs.initStatus !== undefined && asyncJobs.initStatus != eJobInProgress)
              asyncJobDone(asyncJobs, asyncJobID, asyncJobs.initStatus,asyncJobs.initValues);
          else
              asyncWait(asyncJobs, asyncJobID, 0);
      }
  }

}

function anonymousViewController($scope,
                                $location,
                                $window,
                                $injector,
                                $cookies,
                                $parse,
                                xmpResource,
                                adorDeclareCB,
                                setupDefaultErrorPageCB)
{
  /*
    setup functionality commond to anonymous visitor and recipient visitor pages
  */
commonControllersSetup($scope,
                          $location,
                          $window,
                          $injector,
                          $cookies,
                          $parse,
                          xmpResource,
                          adorDeclareCB,
                          setupDefaultErrorPageCB);


  /*
    setup visitor with recipient empty data
  */
  $scope.xmp.recipientID = null; // just for the sake of clear declaration really
  $scope.xmp.r = {};

  // login, so it is possible to run services [not passing cached recipient ID to make a point that this is anonymous]
  xmpResource.debug('anonymousViewController: running login only (no retrieve). service token cookie =', $cookies.xmpServiceToken, 'recipient id cookie =', $cookies.xmpRecipientID);
  xmpResource.login($cookies.xmpServiceToken,null,false).$promise.then(
      function(result)
      {
          // save in cookies
          $cookies.xmpServiceToken = xmpResource.access.serviceToken;

          // use recipient ready to mark event
          recipientReady($scope);

          // setup referred recipient
          referredRecipientSetup($scope,$location,$cookies,xmpResource);

      },
      function(reason)
      {
        // failure [mark using recipientFailed, though not recipient at all]
        recipientError($scope,reason);

        // null referred recipient
        referredRecipientError($scope);
      }

    );

  // method will add a new recipient, to implement anonymous registration form
  $scope.addRecipientForFields = function(inFields,inActionParameters,inExtraADORsForRetrieve)
  {
    /*
      this method, in the context of an anonymous visitor, would actually add this new recipient to the DB
    */

    if(inFields)
    {
      var savedADORs = {};

      for(var key in inFields)
        savedADORs[key] = inActionParameters.xmp.r[key]; // get the values from the parameters, should be isolated from this scope

      /*
        make post call for adding recipient. pass adors to set, and adors to be returned, for later email.
      */
      var getADORs = [];
      if($scope.defaultAdorsForGet)
      {
        for(var key in $scope.defaultAdorsForGet)
          getADORs.push(key);
      }
      if(inExtraADORsForRetrieve)
      {
        inExtraADORsForRetrieve.forEach(function(key)
        {
            getADORs.push(key);
        });
      }

      setupLoadStatus($scope.xmp,'r',getADORs,eADORsLoading);

      var resolvedADORs = [];
      if($scope.defaultAdorsForResolve)
        resolvedADORs = Object.keys($scope.defaultAdorsForResolve);

      xmpResource.debug('addRecipientForFields: adding recipient [registration]. saved data =', savedADORs, '. data to retrieve = ', getADORs);
      xmpResource.addRecipient({
                  adors:savedADORs,
                  retrieveADORs:getADORs,
                  resolvedADORs:resolvedADORs
        }).$promise.then(function(result)
      {

        // recipient ID and Data is
        $scope.xmp.recipientID = result.recipientID;

        var resultAnalysis = analyzeGetADORSResponse(result.values,'r');
        resultAnalysis.readyADORs.forEach(function(key)
        {
            $scope.xmp.r[key] = result.values[key];
        });
        setupLoadStatus($scope.xmp,'r',resultAnalysis.readyADORs,eADORsLoaded);
        $scope.trackAsyncJobs(resultAnalysis.asyncJobs); 


        // save in cookies for next page
        $cookies.xmpRecipientID = $scope.xmp.recipientID;

        // remove xmp from scope, so can access retrieved higher level content for things like
        // email sending and actions
        delete inActionParameters.xmp;

        xmpResource.debug('addRecipientForFields: success in adding recipient [registration]. recipient id = ', $scope.xmp.recipientID);

        onRecipientSubmitSuccess($window, $location,$parse,xmpResource, $scope, inActionParameters);
      },
      getFailureCBForRecipientSubmit($location,$parse,$scope, xmpResource, inActionParameters));

    }    
  }

}


/*
  Controller for a non-personalized page. no recipient ID.
*/
xmpControllers.controller('XMPAnonymousPage', ['$scope',
                                                '$element',
                                                '$location',
                                                '$window',
                                                '$injector',
                                                '$cookies',
                                                '$parse',
                                                '$compile',
                                                'xmpResource',
                                                function ($scope,
                                                    $element,
                                                    $location,
                                                    $window,
                                                    $injector,
                                                    $cookies,
                                                    $parse,
                                                    $compile,
                                                    xmpResource) {
                                                  anonymousViewController($scope,
                                                                              $location,
                                                                              $window,
                                                                              $injector,
                                                                              $cookies,
                                                                              $parse,
                                                                              xmpResource,
                                                                              function()
                                                                              {
                                                                                xmpResource.declareRecipientADORsInJQueryElement($element);
                                                                                 xmpResource.debug('XMPAnonymousPage: Scanning ADORs on $element');

                                                                              },
                                                                              function()
                                                                              {
                                                                                createDefaultErrorNode($element,$compile,$scope);
                                                                                xmpResource.debug('XMPAnonymousPage: creating default error element');
                                                                              }
                                                                              );                                                  

}]);


xmpControllers.controller('XMPAnonymousView', ['$scope',
                                                '$location',
                                                '$window',
                                                '$injector',
                                                '$cookies',
                                                '$parse',
                                                '$rootElement',
                                                'xmpResource',
                                                function ($scope,
                                                    $location,
                                                    $window,
                                                    $injector,
                                                    $cookies,
                                                    $parse,
                                                    $rootElement,
                                                    xmpResource) {
                                                  anonymousViewController($scope,
                                                                              $location,
                                                                              $window,
                                                                              $injector,
                                                                              $cookies,
                                                                              $parse,
                                                                              xmpResource,
                                                                              function()
                                                                              {
                                                                                // allow adors scanning in case used in the context of a view
                                                                                var $ngView = $rootElement.find('[ng-view]');
                                                                                if($ngView.length > 0)
                                                                                {
                                                                                  xmpResource.declareRecipientADORsInJQueryElement($ngView);
                                                                                  xmpResource.debug('XMPAnonymousView: Scanning ADORs on $ngView');
                                                                                }
                                                                                else
                                                                                  xmpResource.debug('XMPAnonymousView: $ngView not found, not scanning for ADORs');                                                                                 
                                                                              },
                                                                              function()
                                                                              {
                                                                                
                                                                              }
                                                                              );                                                  

}]);



/*!
 * Platform.js v1.0.0 <http://mths.be/platform>
 * Copyright 2010-2014 John-David Dalton <http://allyoucanleet.com/>
 * Available under MIT license <http://mths.be/mit>
 */
;(function() {
  'use strict';

  /** Used to determine if values are of the language type Object */
  var objectTypes = {
    'function': true,
    'object': true
  };

  /** Used as a reference to the global object */
  var root = (objectTypes[typeof window] && window) || this;

  /** Backup possible global object */
  var oldRoot = root;

  /** Detect free variable `exports` */
  var freeExports = objectTypes[typeof exports] && exports;

  /** Detect free variable `module` */
  var freeModule = objectTypes[typeof module] && module && !module.nodeType && module;

  /** Detect free variable `global` from Node.js or Browserified code and use it as `root` */
  var freeGlobal = freeExports && freeModule && typeof global == 'object' && global;
  if (freeGlobal && (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal || freeGlobal.self === freeGlobal)) {
    root = freeGlobal;
  }

  /**
   * Used as the maximum length of an array-like object.
   * See the [ES6 spec](http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength)
   * for more details.
   */
  var maxSafeInteger = Math.pow(2, 53) - 1;

  /** Opera regexp */
  var reOpera = /Opera/;

  /** Possible global object */
  var thisBinding = this;

  /** Used for native method references */
  var objectProto = Object.prototype;

  /** Used to check for own properties of an object */
  var hasOwnProperty = objectProto.hasOwnProperty;

  /** Used to resolve the internal `[[Class]]` of values */
  var toString = objectProto.toString;

  /*--------------------------------------------------------------------------*/

  /**
   * Capitalizes a string value.
   *
   * @private
   * @param {string} string The string to capitalize.
   * @returns {string} The capitalized string.
   */
  function capitalize(string) {
    string = String(string);
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  /**
   * An iteration utility for arrays and objects.
   *
   * @private
   * @param {Array|Object} object The object to iterate over.
   * @param {Function} callback The function called per iteration.
   */
  function each(object, callback) {
    var index = -1,
        length = object ? object.length : 0;

    if (typeof length == 'number' && length > -1 && length <= maxSafeInteger) {
      while (++index < length) {
        callback(object[index], index, object);
      }
    } else {
      forOwn(object, callback);
    }
  }

  /**
   * Trim and conditionally capitalize string values.
   *
   * @private
   * @param {string} string The string to format.
   * @returns {string} The formatted string.
   */
  function format(string) {
    string = trim(string);
    return /^(?:webOS|i(?:OS|P))/.test(string)
      ? string
      : capitalize(string);
  }

  /**
   * Iterates over an object's own properties, executing the `callback` for each.
   *
   * @private
   * @param {Object} object The object to iterate over.
   * @param {Function} callback The function executed per own property.
   */
  function forOwn(object, callback) {
    for (var key in object) {
      if (hasOwnProperty.call(object, key)) {
        callback(object[key], key, object);
      }
    }
  }

  /**
   * Gets the internal [[Class]] of a value.
   *
   * @private
   * @param {*} value The value.
   * @returns {string} The [[Class]].
   */
  function getClassOf(value) {
    return value == null
      ? capitalize(value)
      : toString.call(value).slice(8, -1);
  }

  /**
   * Host objects can return type values that are different from their actual
   * data type. The objects we are concerned with usually return non-primitive
   * types of "object", "function", or "unknown".
   *
   * @private
   * @param {*} object The owner of the property.
   * @param {string} property The property to check.
   * @returns {boolean} Returns `true` if the property value is a non-primitive, else `false`.
   */
  function isHostType(object, property) {
    var type = object != null ? typeof object[property] : 'number';
    return !/^(?:boolean|number|string|undefined)$/.test(type) &&
      (type == 'object' ? !!object[property] : true);
  }

  /**
   * Prepares a string for use in a `RegExp` by making hyphens and spaces optional.
   *
   * @private
   * @param {string} string The string to qualify.
   * @returns {string} The qualified string.
   */
  function qualify(string) {
    return String(string).replace(/([ -])(?!$)/g, '$1?');
  }

  /**
   * A bare-bones `Array#reduce` like utility function.
   *
   * @private
   * @param {Array} array The array to iterate over.
   * @param {Function} callback The function called per iteration.
   * @returns {*} The accumulated result.
   */
  function reduce(array, callback) {
    var accumulator = null;
    each(array, function(value, index) {
      accumulator = callback(accumulator, value, index, array);
    });
    return accumulator;
  }

  /**
   * Removes leading and trailing whitespace from a string.
   *
   * @private
   * @param {string} string The string to trim.
   * @returns {string} The trimmed string.
   */
  function trim(string) {
    return String(string).replace(/^ +| +$/g, '');
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Creates a new platform object.
   *
   * @memberOf platform
   * @param {Object|string} [ua=navigator.userAgent] The user agent string or
   *  context object.
   * @returns {Object} A platform object.
   */
  function parse(ua) {

    /** The environment context object */
    var context = root;

    /** Used to flag when a custom context is provided */
    var isCustomContext = ua && typeof ua == 'object' && getClassOf(ua) != 'String';

    // juggle arguments
    if (isCustomContext) {
      context = ua;
      ua = null;
    }

    /** Browser navigator object */
    var nav = context.navigator || {};

    /** Browser user agent string */
    var userAgent = nav.userAgent || '';

    ua || (ua = userAgent);

    /** Used to flag when `thisBinding` is the [ModuleScope] */
    var isModuleScope = isCustomContext || thisBinding == oldRoot;

    /** Used to detect if browser is like Chrome */
    var likeChrome = isCustomContext
      ? !!nav.likeChrome
      : /\bChrome\b/.test(ua) && !/internal|\n/i.test(toString.toString());

    /** Internal [[Class]] value shortcuts */
    var objectClass = 'Object',
        airRuntimeClass = isCustomContext ? objectClass : 'ScriptBridgingProxyObject',
        enviroClass = isCustomContext ? objectClass : 'Environment',
        javaClass = (isCustomContext && context.java) ? 'JavaPackage' : getClassOf(context.java),
        phantomClass = isCustomContext ? objectClass : 'RuntimeObject';

    /** Detect Java environment */
    var java = /Java/.test(javaClass) && context.java;

    /** Detect Rhino */
    var rhino = java && getClassOf(context.environment) == enviroClass;

    /** A character to represent alpha */
    var alpha = java ? 'a' : '\u03b1';

    /** A character to represent beta */
    var beta = java ? 'b' : '\u03b2';

    /** Browser document object */
    var doc = context.document || {};

    /**
     * Detect Opera browser
     * http://www.howtocreate.co.uk/operaStuff/operaObject.html
     * http://dev.opera.com/articles/view/opera-mini-web-content-authoring-guidelines/#operamini
     */
    var opera = context.operamini || context.opera;

    /** Opera [[Class]] */
    var operaClass = reOpera.test(operaClass = (isCustomContext && opera) ? opera['[[Class]]'] : getClassOf(opera))
      ? operaClass
      : (opera = null);

    /*------------------------------------------------------------------------*/

    /** Temporary variable used over the script's lifetime */
    var data;

    /** The CPU architecture */
    var arch = ua;

    /** Platform description array */
    var description = [];

    /** Platform alpha/beta indicator */
    var prerelease = null;

    /** A flag to indicate that environment features should be used to resolve the platform */
    var useFeatures = ua == userAgent;

    /** The browser/environment version */
    var version = useFeatures && opera && typeof opera.version == 'function' && opera.version();

    /* Detectable layout engines (order is important) */
    var layout = getLayout([
      { 'label': 'WebKit', 'pattern': 'AppleWebKit' },
      'iCab',
      'Presto',
      'NetFront',
      'Tasman',
      'Trident',
      'KHTML',
      'Gecko'
    ]);

    /* Detectable browser names (order is important) */
    var name = getName([
      'Adobe AIR',
      'Arora',
      'Avant Browser',
      'Camino',
      'Epiphany',
      'Fennec',
      'Flock',
      'Galeon',
      'GreenBrowser',
      'iCab',
      'Iceweasel',
      { 'label': 'SRWare Iron', 'pattern': 'Iron' },
      'K-Meleon',
      'Konqueror',
      'Lunascape',
      'Maxthon',
      'Midori',
      'Nook Browser',
      'PhantomJS',
      'Raven',
      'Rekonq',
      'RockMelt',
      'SeaMonkey',
      { 'label': 'Silk', 'pattern': '(?:Cloud9|Silk-Accelerated)' },
      'Sleipnir',
      'SlimBrowser',
      'Sunrise',
      'Swiftfox',
      'WebPositive',
      'Opera Mini',
      'Opera',
      { 'label': 'Opera', 'pattern': 'OPR' },
      'Chrome',
      { 'label': 'Chrome Mobile', 'pattern': '(?:CriOS|CrMo)' },
      { 'label': 'Firefox', 'pattern': '(?:Firefox|Minefield)' },
      { 'label': 'IE', 'pattern': 'MSIE' },
      'Safari'
    ]);

    /* Detectable products (order is important) */
    var product = getProduct([
      { 'label': 'BlackBerry', 'pattern': 'BB10' },
      'BlackBerry',
      { 'label': 'Galaxy S', 'pattern': 'GT-I9000' },
      { 'label': 'Galaxy S2', 'pattern': 'GT-I9100' },
      { 'label': 'Galaxy S3', 'pattern': 'GT-I9300' },
      { 'label': 'Galaxy S4', 'pattern': 'GT-I9500' },
      'Google TV',
      'iPad',
      'iPod',
      'iPhone',
      'Kindle',
      { 'label': 'Kindle Fire', 'pattern': '(?:Cloud9|Silk-Accelerated)' },
      'Nook',
      'PlayBook',
      'PlayStation 4',
      'PlayStation 3',
      'PlayStation Vita',
      'TouchPad',
      'Transformer',
      { 'label': 'Wii U', 'pattern': 'WiiU' },
      'Wii',
      'Xbox One',
      { 'label': 'Xbox 360', 'pattern': 'Xbox' },
      'Xoom'
    ]);

    /* Detectable manufacturers */
    var manufacturer = getManufacturer({
      'Apple': { 'iPad': 1, 'iPhone': 1, 'iPod': 1 },
      'Amazon': { 'Kindle': 1, 'Kindle Fire': 1 },
      'Asus': { 'Transformer': 1 },
      'Barnes & Noble': { 'Nook': 1 },
      'BlackBerry': { 'PlayBook': 1 },
      'Google': { 'Google TV': 1 },
      'HP': { 'TouchPad': 1 },
      'HTC': { },
      'LG': { },
      'Microsoft': { 'Xbox': 1, 'Xbox One': 1 },
      'Motorola': { 'Xoom': 1 },
      'Nintendo': { 'Wii U': 1,  'Wii': 1 },
      'Nokia': { },
      'Samsung': { 'Galaxy S': 1, 'Galaxy S2': 1, 'Galaxy S3': 1, 'Galaxy S4': 1 },
      'Sony': { 'PlayStation 4': 1, 'PlayStation 3': 1, 'PlayStation Vita': 1 }
    });

    /* Detectable OSes (order is important) */
    var os = getOS([
      'Android',
      'CentOS',
      'Debian',
      'Fedora',
      'FreeBSD',
      'Gentoo',
      'Haiku',
      'Kubuntu',
      'Linux Mint',
      'Red Hat',
      'SuSE',
      'Ubuntu',
      'Xubuntu',
      'Cygwin',
      'Symbian OS',
      'hpwOS',
      'webOS ',
      'webOS',
      'Tablet OS',
      'Linux',
      'Mac OS X',
      'Macintosh',
      'Mac',
      'Windows 98;',
      'Windows '
    ]);

    /*------------------------------------------------------------------------*/

    /**
     * Picks the layout engine from an array of guesses.
     *
     * @private
     * @param {Array} guesses An array of guesses.
     * @returns {null|string} The detected layout engine.
     */
    function getLayout(guesses) {
      return reduce(guesses, function(result, guess) {
        return result || RegExp('\\b' + (
          guess.pattern || qualify(guess)
        ) + '\\b', 'i').exec(ua) && (guess.label || guess);
      });
    }

    /**
     * Picks the manufacturer from an array of guesses.
     *
     * @private
     * @param {Object} guesses An object of guesses.
     * @returns {null|string} The detected manufacturer.
     */
    function getManufacturer(guesses) {
      return reduce(guesses, function(result, value, key) {
        // lookup the manufacturer by product or scan the UA for the manufacturer
        return result || (
          value[product] ||
          value[0/*Opera 9.25 fix*/, /^[a-z]+(?: +[a-z]+\b)*/i.exec(product)] ||
          RegExp('\\b' + qualify(key) + '(?:\\b|\\w*\\d)', 'i').exec(ua)
        ) && key;
      });
    }

    /**
     * Picks the browser name from an array of guesses.
     *
     * @private
     * @param {Array} guesses An array of guesses.
     * @returns {null|string} The detected browser name.
     */
    function getName(guesses) {
      return reduce(guesses, function(result, guess) {
        return result || RegExp('\\b' + (
          guess.pattern || qualify(guess)
        ) + '\\b', 'i').exec(ua) && (guess.label || guess);
      });
    }

    /**
     * Picks the OS name from an array of guesses.
     *
     * @private
     * @param {Array} guesses An array of guesses.
     * @returns {null|string} The detected OS name.
     */
    function getOS(guesses) {
      return reduce(guesses, function(result, guess) {
        var pattern = guess.pattern || qualify(guess);
        if (!result && (result =
              RegExp('\\b' + pattern + '(?:/[\\d.]+|[ \\w.]*)', 'i').exec(ua)
            )) {
          // platform tokens defined at
          // http://msdn.microsoft.com/en-us/library/ms537503(VS.85).aspx
          // http://web.archive.org/web/20081122053950/http://msdn.microsoft.com/en-us/library/ms537503(VS.85).aspx
          data = {
            '6.3':  '8.1',
            '6.2':  '8',
            '6.1':  'Server 2008 R2 / 7',
            '6.0':  'Server 2008 / Vista',
            '5.2':  'Server 2003 / XP 64-bit',
            '5.1':  'XP',
            '5.01': '2000 SP1',
            '5.0':  '2000',
            '4.0':  'NT',
            '4.90': 'ME'
          };
          // detect Windows version from platform tokens
          if (/^Win/i.test(result) &&
              (data = data[0/*Opera 9.25 fix*/, /[\d.]+$/.exec(result)])) {
            result = 'Windows ' + data;
          }
          // correct character case and cleanup
          result = format(String(result)
            .replace(RegExp(pattern, 'i'), guess.label || guess)
            .replace(/ ce$/i, ' CE')
            .replace(/hpw/i, 'web')
            .replace(/Macintosh/, 'Mac OS')
            .replace(/_PowerPC/i, ' OS')
            .replace(/(OS X) [^ \d]+/i, '$1')
            .replace(/Mac (OS X)/, '$1')
            .replace(/\/(\d)/, ' $1')
            .replace(/_/g, '.')
            .replace(/(?: BePC|[ .]*fc[ \d.]+)$/i, '')
            .replace(/x86\.64/gi, 'x86_64')
            .split(' on ')[0]);
        }
        return result;
      });
    }

    /**
     * Picks the product name from an array of guesses.
     *
     * @private
     * @param {Array} guesses An array of guesses.
     * @returns {null|string} The detected product name.
     */
    function getProduct(guesses) {
      return reduce(guesses, function(result, guess) {
        var pattern = guess.pattern || qualify(guess);
        if (!result && (result =
              RegExp('\\b' + pattern + ' *\\d+[.\\w_]*', 'i').exec(ua) ||
              RegExp('\\b' + pattern + '(?:; *(?:[a-z]+[_-])?[a-z]+\\d+|[^ ();-]*)', 'i').exec(ua)
            )) {
          // split by forward slash and append product version if needed
          if ((result = String((guess.label && !RegExp(pattern, 'i').test(guess.label)) ? guess.label : result).split('/'))[1] && !/[\d.]+/.test(result[0])) {
            result[0] += ' ' + result[1];
          }
          // correct character case and cleanup
          guess = guess.label || guess;
          result = format(result[0]
            .replace(RegExp(pattern, 'i'), guess)
            .replace(RegExp('; *(?:' + guess + '[_-])?', 'i'), ' ')
            .replace(RegExp('(' + guess + ')[-_.]?(\\w)', 'i'), '$1 $2'));
        }
        return result;
      });
    }

    /**
     * Resolves the version using an array of UA patterns.
     *
     * @private
     * @param {Array} patterns An array of UA patterns.
     * @returns {null|string} The detected version.
     */
    function getVersion(patterns) {
      return reduce(patterns, function(result, pattern) {
        return result || (RegExp(pattern +
          '(?:-[\\d.]+/|(?: for [\\w-]+)?[ /-])([\\d.]+[^ ();/_-]*)', 'i').exec(ua) || 0)[1] || null;
      });
    }

    /**
     * Returns `platform.description` when the platform object is coerced to a string.
     *
     * @name toString
     * @memberOf platform
     * @returns {string} Returns `platform.description` if available, else an empty string.
     */
    function toStringPlatform() {
      return this.description || '';
    }

    /*------------------------------------------------------------------------*/

    // convert layout to an array so we can add extra details
    layout && (layout = [layout]);

    // detect product names that contain their manufacturer's name
    if (manufacturer && !product) {
      product = getProduct([manufacturer]);
    }
    // clean up Google TV
    if ((data = /Google TV/.exec(product))) {
      product = data[0];
    }
    // detect simulators
    if (/\bSimulator\b/i.test(ua)) {
      product = (product ? product + ' ' : '') + 'Simulator';
    }
    // detect iOS
    if (/^iP/.test(product)) {
      name || (name = 'Safari');
      os = 'iOS' + ((data = / OS ([\d_]+)/i.exec(ua))
        ? ' ' + data[1].replace(/_/g, '.')
        : '');
    }
    // detect Kubuntu
    else if (name == 'Konqueror' && !/buntu/i.test(os)) {
      os = 'Kubuntu';
    }
    // detect Android browsers
    else if (manufacturer && manufacturer != 'Google' &&
        ((/Chrome/.test(name) && !/Mobile Safari/.test(ua)) || /Vita/.test(product))) {
      name = 'Android Browser';
      os = /Android/.test(os) ? os : 'Android';
    }
    // detect false positives for Firefox/Safari
    else if (!name || (data = !/\bMinefield\b|\(Android;/i.test(ua) && /Firefox|Safari/.exec(name))) {
      // escape the `/` for Firefox 1
      if (name && !product && /[\/,]|^[^(]+?\)/.test(ua.slice(ua.indexOf(data + '/') + 8))) {
        // clear name of false positives
        name = null;
      }
      // reassign a generic name
      if ((data = product || manufacturer || os) &&
          (product || manufacturer || /Android|Symbian OS|Tablet OS|webOS/.test(os))) {
        name = /[a-z]+(?: Hat)?/i.exec(/Android/.test(os) ? os : data) + ' Browser';
      }
    }
    // detect Firefox OS
    if ((data = /\((Mobile|Tablet).*?Firefox/i.exec(ua)) && data[1]) {
      os = 'Firefox OS';
      if (!product) {
        product = data[1];
      }
    }
    // detect non-Opera versions (order is important)
    if (!version) {
      version = getVersion([
        '(?:Cloud9|CriOS|CrMo|Iron|Opera ?Mini|OPR|Raven|Silk(?!/[\\d.]+$))',
        'Version',
        qualify(name),
        '(?:Firefox|Minefield|NetFront)'
      ]);
    }
    // detect stubborn layout engines
    if (layout == 'iCab' && parseFloat(version) > 3) {
      layout = ['WebKit'];
    } else if ((data =
          /Opera/.test(name) && (/OPR/.test(ua) ? 'Blink' : 'Presto') ||
          /\b(?:Midori|Nook|Safari)\b/i.test(ua) && 'WebKit' ||
          !layout && /\bMSIE\b/i.test(ua) && (os == 'Mac OS' ? 'Tasman' : 'Trident')
        )) {
      layout = [data];
    }
    // detect NetFront on PlayStation
    else if (/PlayStation(?! Vita)/i.test(name) && layout == 'WebKit') {
      layout = ['NetFront'];
    }
    // detect IE 11 and above
    if (!name && layout == 'Trident') {
      name = 'IE';
      version = (/\brv:([\d.]+)/.exec(ua) || 0)[1];
    }
    // leverage environment features
    if (useFeatures) {
      // detect server-side environments
      // Rhino has a global function while others have a global object
      if (isHostType(context, 'global')) {
        if (java) {
          data = java.lang.System;
          arch = data.getProperty('os.arch');
          os = os || data.getProperty('os.name') + ' ' + data.getProperty('os.version');
        }
        if (isHostType(context, 'exports')) {
          if (isModuleScope && isHostType(context, 'system') && (data = [context.system])[0]) {
            os || (os = data[0].os || null);
            try {
              data[1] = (data[1] = context.require) && data[1]('ringo/engine').version;
              version = data[1].join('.');
              name = 'RingoJS';
            } catch(e) {
              if (data[0].global.system == context.system) {
                name = 'Narwhal';
              }
            }
          }
          else if (typeof context.process == 'object' && (data = context.process)) {
            name = 'Node.js';
            arch = data.arch;
            os = data.platform;
            version = /[\d.]+/.exec(data.version)[0];
          }
          else if (rhino) {
            name = 'Rhino';
          }
        }
        else if (rhino) {
          name = 'Rhino';
        }
      }
      // detect Adobe AIR
      else if (getClassOf((data = context.runtime)) == airRuntimeClass) {
        name = 'Adobe AIR';
        os = data.flash.system.Capabilities.os;
      }
      // detect PhantomJS
      else if (getClassOf((data = context.phantom)) == phantomClass) {
        name = 'PhantomJS';
        version = (data = data.version || null) && (data.major + '.' + data.minor + '.' + data.patch);
      }
      // detect IE compatibility modes
      else if (typeof doc.documentMode == 'number' && (data = /\bTrident\/(\d+)/i.exec(ua))) {
        // we're in compatibility mode when the Trident version + 4 doesn't
        // equal the document mode
        version = [version, doc.documentMode];
        if ((data = +data[1] + 4) != version[1]) {
          description.push('IE ' + version[1] + ' mode');
          layout && (layout[1] = '');
          version[1] = data;
        }
        version = name == 'IE' ? String(version[1].toFixed(1)) : version[0];
      }
      os = os && format(os);
    }
    // detect prerelease phases
    if (version && (data =
          /(?:[ab]|dp|pre|[ab]\d+pre)(?:\d+\+?)?$/i.exec(version) ||
          /(?:alpha|beta)(?: ?\d)?/i.exec(ua + ';' + (useFeatures && nav.appMinorVersion)) ||
          /\bMinefield\b/i.test(ua) && 'a'
        )) {
      prerelease = /b/i.test(data) ? 'beta' : 'alpha';
      version = version.replace(RegExp(data + '\\+?$'), '') +
        (prerelease == 'beta' ? beta : alpha) + (/\d+\+?/.exec(data) || '');
    }
    // detect Firefox Mobile
    if (name == 'Fennec' || name == 'Firefox' && /Android|Firefox OS/.test(os)) {
      name = 'Firefox Mobile';
    }
    // obscure Maxthon's unreliable version
    else if (name == 'Maxthon' && version) {
      version = version.replace(/\.[\d.]+/, '.x');
    }
    // detect Silk desktop/accelerated modes
    else if (name == 'Silk') {
      if (!/Mobi/i.test(ua)) {
        os = 'Android';
        description.unshift('desktop mode');
      }
      if (/Accelerated *= *true/i.test(ua)) {
        description.unshift('accelerated');
      }
    }
    // detect Windows Phone desktop mode
    else if (name == 'IE' && (data = (/; *(?:XBLWP|ZuneWP)(\d+)/i.exec(ua) || 0)[1])) {
        name += ' Mobile';
        os = 'Windows Phone OS ' + data + '.x';
        description.unshift('desktop mode');
    }
    // detect Xbox 360 and Xbox One
    else if (/Xbox/i.test(product)) {
      os = null;
      if (product == 'Xbox 360' && /IEMobile/.test(ua)) {
        description.unshift('mobile mode');
      }
    }
    // add mobile postfix
    else if ((name == 'Chrome' || name == 'IE' || name && !product && !/Browser|Mobi/.test(name)) &&
        (os == 'Windows CE' || /Mobi/i.test(ua))) {
      name += ' Mobile';
    }
    // detect IE platform preview
    else if (name == 'IE' && useFeatures && context.external === null) {
      description.unshift('platform preview');
    }
    // detect BlackBerry OS version
    // http://docs.blackberry.com/en/developers/deliverables/18169/HTTP_headers_sent_by_BB_Browser_1234911_11.jsp
    else if ((/BlackBerry/.test(product) || /BB10/.test(ua)) && (data =
          (RegExp(product.replace(/ +/g, ' *') + '/([.\\d]+)', 'i').exec(ua) || 0)[1] ||
          version
        )) {
      data = [data, /BB10/.test(ua)];
      os = (data[1] ? (product = null, manufacturer = 'BlackBerry') : 'Device Software') + ' ' + data[0];
      version = null;
    }
    // detect Opera identifying/masking itself as another browser
    // http://www.opera.com/support/kb/view/843/
    else if (this != forOwn && (
          product != 'Wii' && (
            (useFeatures && opera) ||
            (/Opera/.test(name) && /\b(?:MSIE|Firefox)\b/i.test(ua)) ||
            (name == 'Firefox' && /OS X (?:\d+\.){2,}/.test(os)) ||
            (name == 'IE' && (
              (os && !/^Win/.test(os) && version > 5.5) ||
              /Windows XP/.test(os) && version > 8 ||
              version == 8 && !/Trident/.test(ua)
            ))
          )
        ) && !reOpera.test((data = parse.call(forOwn, ua.replace(reOpera, '') + ';'))) && data.name) {

      // when "indentifying", the UA contains both Opera and the other browser's name
      data = 'ing as ' + data.name + ((data = data.version) ? ' ' + data : '');
      if (reOpera.test(name)) {
        if (/IE/.test(data) && os == 'Mac OS') {
          os = null;
        }
        data = 'identify' + data;
      }
      // when "masking", the UA contains only the other browser's name
      else {
        data = 'mask' + data;
        if (operaClass) {
          name = format(operaClass.replace(/([a-z])([A-Z])/g, '$1 $2'));
        } else {
          name = 'Opera';
        }
        if (/IE/.test(data)) {
          os = null;
        }
        if (!useFeatures) {
          version = null;
        }
      }
      layout = ['Presto'];
      description.push(data);
    }
    // detect WebKit Nightly and approximate Chrome/Safari versions
    if ((data = (/\bAppleWebKit\/([\d.]+\+?)/i.exec(ua) || 0)[1])) {
      // correct build for numeric comparison
      // (e.g. "532.5" becomes "532.05")
      data = [parseFloat(data.replace(/\.(\d)$/, '.0$1')), data];
      // nightly builds are postfixed with a `+`
      if (name == 'Safari' && data[1].slice(-1) == '+') {
        name = 'WebKit Nightly';
        prerelease = 'alpha';
        version = data[1].slice(0, -1);
      }
      // clear incorrect browser versions
      else if (version == data[1] ||
          version == (data[2] = (/\bSafari\/([\d.]+\+?)/i.exec(ua) || 0)[1])) {
        version = null;
      }
      // use the full Chrome version when available
      data[1] = (/\bChrome\/([\d.]+)/i.exec(ua) || 0)[1];
      // detect Blink layout engine
      if (data[0] == 537.36 && data[2] == 537.36 && parseFloat(data[1]) >= 28) {
        layout = ['Blink'];
      }
      // detect JavaScriptCore
      // http://stackoverflow.com/questions/6768474/how-can-i-detect-which-javascript-engine-v8-or-jsc-is-used-at-runtime-in-androi
      if (!useFeatures || (!likeChrome && !data[1])) {
        layout && (layout[1] = 'like Safari');
        data = (data = data[0], data < 400 ? 1 : data < 500 ? 2 : data < 526 ? 3 : data < 533 ? 4 : data < 534 ? '4+' : data < 535 ? 5 : data < 537 ? 6 : data < 538 ? 7 : '7');
      } else {
        layout && (layout[1] = 'like Chrome');
        data = data[1] || (data = data[0], data < 530 ? 1 : data < 532 ? 2 : data < 532.05 ? 3 : data < 533 ? 4 : data < 534.03 ? 5 : data < 534.07 ? 6 : data < 534.10 ? 7 : data < 534.13 ? 8 : data < 534.16 ? 9 : data < 534.24 ? 10 : data < 534.30 ? 11 : data < 535.01 ? 12 : data < 535.02 ? '13+' : data < 535.07 ? 15 : data < 535.11 ? 16 : data < 535.19 ? 17 : data < 536.05 ? 18 : data < 536.10 ? 19 : data < 537.01 ? 20 : data < 537.11 ? '21+' : data < 537.13 ? 23 : data < 537.18 ? 24 : data < 537.24 ? 25 : data < 537.36 ? 26 : layout != 'Blink' ? '27' : '28');
      }
      // add the postfix of ".x" or "+" for approximate versions
      layout && (layout[1] += ' ' + (data += typeof data == 'number' ? '.x' : /[.+]/.test(data) ? '' : '+'));
      // obscure version for some Safari 1-2 releases
      if (name == 'Safari' && (!version || parseInt(version) > 45)) {
        version = data;
      }
    }
    // detect Opera desktop modes
    if (name == 'Opera' &&  (data = /(?:zbov|zvav)$/.exec(os))) {
      name += ' ';
      description.unshift('desktop mode');
      if (data == 'zvav') {
        name += 'Mini';
        version = null;
      } else {
        name += 'Mobile';
      }
    }
    // detect Chrome desktop mode
    else if (name == 'Safari' && /Chrome/.exec(layout && layout[1])) {
      description.unshift('desktop mode');
      name = 'Chrome Mobile';
      version = null;

      if (/OS X/.test(os)) {
        manufacturer = 'Apple';
        os = 'iOS 4.3+';
      } else {
        os = null;
      }
    }
    // strip incorrect OS versions
    if (version && version.indexOf((data = /[\d.]+$/.exec(os))) == 0 &&
        ua.indexOf('/' + data + '-') > -1) {
      os = trim(os.replace(data, ''));
    }
    // add layout engine
    if (layout && !/Avant|Nook/.test(name) && (
        /Browser|Lunascape|Maxthon/.test(name) ||
        /^(?:Adobe|Arora|Midori|Phantom|Rekonq|Rock|Sleipnir|Web)/.test(name) && layout[1])) {
      // don't add layout details to description if they are falsey
      (data = layout[layout.length - 1]) && description.push(data);
    }
    // combine contextual information
    if (description.length) {
      description = ['(' + description.join('; ') + ')'];
    }
    // append manufacturer
    if (manufacturer && product && product.indexOf(manufacturer) < 0) {
      description.push('on ' + manufacturer);
    }
    // append product
    if (product) {
      description.push((/^on /.test(description[description.length -1]) ? '' : 'on ') + product);
    }
    // parse OS into an object
    if (os) {
      data = / ([\d.+]+)$/.exec(os);
      os = {
        'architecture': 32,
        'family': data ? os.replace(data[0], '') : os,
        'version': data ? data[1] : null,
        'toString': function() {
          var version = this.version;
          return this.family + (version ? ' ' + version : '') + (this.architecture == 64 ? ' 64-bit' : '');
        }
      };
    }
    // add browser/OS architecture
    if ((data = /\b(?:AMD|IA|Win|WOW|x86_|x)64\b/i.exec(arch)) && !/\bi686\b/i.test(arch)) {
      if (os) {
        os.architecture = 64;
        os.family = os.family.replace(RegExp(' *' + data), '');
      }
      if (name && (/WOW64/i.test(ua) ||
          (useFeatures && /\w(?:86|32)$/.test(nav.cpuClass || nav.platform)))) {
        description.unshift('32-bit');
      }
    }

    ua || (ua = null);

    /*------------------------------------------------------------------------*/

    /**
     * The platform object.
     *
     * @name platform
     * @type Object
     */
    var platform = {};

    /**
     * The platform description.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.description = ua;

    /**
     * The name of the browser's layout engine.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.layout = layout && layout[0];

    /**
     * The name of the product's manufacturer.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.manufacturer = manufacturer;

    /**
     * The name of the browser/environment.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.name = name;

    /**
     * The alpha/beta release indicator.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.prerelease = prerelease;

    /**
     * The name of the product hosting the browser.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.product = product;

    /**
     * The browser's user agent string.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.ua = ua;

    /**
     * The browser/environment version.
     *
     * @memberOf platform
     * @type string|null
     */
    platform.version = name && version;

    /**
     * The name of the operating system.
     *
     * @memberOf platform
     * @type Object
     */
    platform.os = os || {

      /**
       * The CPU architecture the OS is built for.
       *
       * @memberOf platform.os
       * @type number|null
       */
      'architecture': null,

      /**
       * The family of the OS.
       *
       * @memberOf platform.os
       * @type string|null
       */
      'family': null,

      /**
       * The version of the OS.
       *
       * @memberOf platform.os
       * @type string|null
       */
      'version': null,

      /**
       * Returns the OS string.
       *
       * @memberOf platform.os
       * @returns {string} The OS string.
       */
      'toString': function() { return 'null'; }
    };

    platform.parse = parse;
    platform.toString = toStringPlatform;

    if (platform.version) {
      description.unshift(version);
    }
    if (platform.name) {
      description.unshift(name);
    }
    if (os && name && !(os == String(os).split(' ')[0] && (os == name.split(' ')[0] || product))) {
      description.push(product ? '(' + os + ')' : 'on ' + os);
    }
    if (description.length) {
      platform.description = description.join(' ');
    }
    return platform;
  }

  /*--------------------------------------------------------------------------*/

  // export platform
  // some AMD build optimizers, like r.js, check for condition patterns like the following:
  if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
    // define as an anonymous module so, through path mapping, it can be aliased
    define('platform',[],function() {
      return parse();
    });
  }
  // check for `exports` after `define` in case a build optimizer adds an `exports` object
  else if (freeExports && freeModule) {
    // in Narwhal, Node.js, Rhino -require, or RingoJS
    forOwn(parse(), function(value, key) {
      freeExports[key] = value;
    });
  }
  // in a browser or Rhino
  else {
    root.platform = parse();
  }
}.call(this));

'use strict';

/*
	xmpResource, defines the services required for XMPie.
	It mostly implements a convenience javascript client for the REST API
	with uCreate XM Server.

	to access the REST service methods one needs 2 elements:
	1. uCreate XM Server URL - the address of the service which the site speaks with
	2. resource token - Identifier for the particular resource at the server that is the source of data and other materials.
						Resource token is calculated ןinternally in XMPResource as combination of an access token and a service token.
						Access token is provided when logging to circle and is a combination of the login data and selection of project.
						Service token is provided by making an initial call the xmpResource loging method. it may be cached after an initial login
						with the data.

	For some services an extra recipient ID is required.

	initial call to the login function of the resource is required to enable the handshake with the REST service. it returns a service token
	which may be used for later call with the access token as identifier of the caller and choice of target data source (resource).

	default configuration of the server URL, access token and (cached) service token are possible. using xmpResourceProvider for .config you can make
	a call to the provider .configure method passing a struture that defines either all or part of the 3:

    inProvider.configure({
      access:{
      		url: THE_UCREATE_XM_SERVER_URL,
      		accessToken: THE_ACCESS_TOKEN,
      		serviceToken: THE_SERVICE_TOKEN
      }
    });

	note that most times, you can avoid and call login instead. setting the serviceToken directly on the resource after will make sense.
	do so by:
	xmpResource.access.serviceToken = SERVICE_TOKEN


	Alternatively to use defaults on the resource you can pass access data on every call. Each call recieves an options structure which may have access
	structure which may have any of the keys (url, accessToken,serviceToken) which may override the defaults. like this:
	the_call(the_call_params,{
		access:
		{
      		url: THE_UCREATE_XM_SERVER_URL,
      		accessToken: THE_ACCESS_TOKEN,
      		serviceToken: THE_SERVICE_TOKEN
		},
		.... [other call optional parameters]
	},other_call_params);


	other configuration parametsrs:

	timeout - default timeouts for HTTP Calls, e.g.:
		inProvider.configure({
				timeout:1000
			}
		});
	dontCacheGets - tells uCreate XM server not to cache any later "get" requests (adors and assts), e.g.:
		inProvider.configure({
				dontCacheGets:true
			}
		});
	test - tells a later login to login with either test or none. by default the URL will be inpsected for "isTest" parameter.

*/

function XmpResource($resource,$http,$location,$log,inOptions)  
{
	var self = this;
	if(inOptions)
	{
		['access','timeout','debugEnabled'].forEach(function(inValue)
		{
			if(inOptions[inValue] !== undefined)
				self[inValue] = inOptions[inValue];
		})
	}
	if(!this.access)
		this.access = {};
	this.resourceConfig = this.timeout !== undefined ? {timeout:this.timeout}:null;
	this.$resource = $resource;
	this.$http = $http;
	this.$location = $location;
	this.$log = $log;
}


function accessURL(self,inOptions)
{
	return inOptions && inOptions.access ?
		(inOptions.access.url ? inOptions.access.url:self.access.url):
		self.access.url;
}

function serviceToken(self,inOptions)
{
	return inOptions && inOptions.access ?
		(inOptions.access.serviceToken ? inOptions.access.serviceToken:self.access.serviceToken):
		self.access.serviceToken;
}

function accessToken(self,inOptions)
{
	return inOptions && inOptions.access ?
		(inOptions.access.accessToken ? inOptions.access.accessToken:self.access.accessToken):
		self.access.accessToken;
}

function resourceToken(self,inOptions)
{
	var st = serviceToken(self,inOptions);
	return accessToken(self,inOptions) + ((st && st.length > 0) ? ('_' + st):'');
}


function isTest(self,inOptions)
{
	return (inOptions && inOptions.test !== undefined) ? inOptions.test : (self.$location.search().isTest || self.test);
}

/*
	Login is the first call to the service, aiming to get a service token.
	In addition, if passing a site URL it can retrieve a recipient ID from it, if formed like XMPie purls.

	The method accepts previous cached RID and service token - pass null if there's no such cache. inWithRIDDeciphering will tell the method
	to ask for RID deciphering from the current site url. pass false if you don't want such deciphering - do that, as the server will fail if the URL
	misfits.

	for the sake of convenience, xmpResoruce.access.serviceToken is set with the retrieved token. This will allow calling
	later methods without having to pass it in the options structure (as is the case for service URL and access token which are normally
	configured in the initial configure method).

	the returned result looks like this:
	{
		serviceToken:the_service_token,
		recipientID:the_recipient_id
	}

	note that recipientID may be null or undefined, if recipient ID is not reqeusted.
	the request will fail if asked for recipient ID deciphering and no ID is found in the URL
*/

XmpResource.prototype.login = function(inChachedServiceToken,inCachedRID,inWithRIDDeciphering,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;

	var xmpServer = this.$resource(
								accessURL(this,inOptions) + '/login',
								null,
								{'login': {method: 'POST'}},
								this.resourceConfig);
	var self = this;
	var options = {
							accessToken:accessToken(this,inOptions),
							isTest:isTest(this,inOptions),
							siteURL:inWithRIDDeciphering ? this.$location.absUrl():undefined,
							cached:	{
								serviceToken:inChachedServiceToken,
								recipientID:inCachedRID
							}
						};
  	return xmpServer.login({}, // no parameters all data passed in body
						options,
						function(value,responseHeaders){
									if(!self.access)
										self.access = {};
									self.access.serviceToken = value.serviceToken;

									self.debug('XmpResource.login: login succeeded with input data = ',options,'. returned service token =',value.serviceToken);
									if(inRunWhenSuccess)
										inRunWhenSuccess(value,responseHeaders);
						},
						function(httpResponse)
						{
							inRunWhenFailed(httpResponse);
							self.$log.error('XmpResource.login: login failed with input data = ',options);
							self.$log.error('XmpResource.login: httpResponse = ',httpResponse);
						}
						);		
}


/*
	getRecipientADORs requests ADOR values for inRecipientID per the inOptions options structure provided.
	options may have:
		adors [optional] - array of requested ADORs. if not provided, all ADORs will be retrieved
		async [optional] - if not passed, a resource is returned that when complete will have the recipient data key/value object.
							if true, an async request will start a query job on the server, and return with a job ID. 
							later that ID may be requeried mutliple times with getRecipientQueryStatus. 
							getRecipientQueryStatus will return a status. when the status is ready it will also return the key value pair that
							are the recipient values for the ADORs list.
		login [optional] - login data, for login + query
		resolved [optional] - array of ador names. adors in this list should be resolved. Note that it may be that 'resolved' will appear but 'adors' won't
		noCache [optional] - boolean. don't use cache for this retrieve
		idIsIndex [optional] - boolean. notes that the recipient ID passed is actually not its ID, but rather its index in the arbitrary collection of recipients
								This should be used for simple iterations, from 0 to the recipients count which can be retrieved through getRecipientsCount


	returned result, if non-async, is a dictionary of key-value, where a key is ador name, and value is the ador value.
	if async, will return job id, status, and if done, also the dictionary with key-value providing the ador names/values.

	------
	uImage
	------

	Note that in case of ADORs that are implemented as uImage, the return value will not be a string, but rather an object defining
	an async job, like this:
	{
		"uImage":true,
		"jobID":THE_ASYNC_JOB_ID,
		["status":CURRENT_STATUS]
	}

	'uImage' is a flag to mark this object as uImage (this will enable future devs).
	'jobID' is an async job id started for this uImage calculation.
	'status' is an optional data providing

	if this is the case, use an async job loop to wait for the actual value. See getRecipientQueryStatus for getting status and final value.


	-----
	login
	-----

	getRecipientADORs may be optionally used for login, and spare the need for an initial (other) login. This is useful
	when the page calls getRecipientADORs as an initial,mostly, phase, to save the need for extra REST call.

	in this case pass the login requirements via the inOptions structure:
	inOptions = 
	{
		....
		login:{
			cached:	{
				serviceToken:inChachedServiceToken,
				recipientID:inCachedRID
			}
		}
	}
	[acces token, required for login may be defined in the options structure in the normal way, and is passed as the "resource" parameter]
	note that in this cases inRecipientID will be NULL as you don't have it yet. [it is determined by login]

	In this case, the return result will be an object with two member:
	1. login - login result, like in login specs - {
							serviceToken:the_service_token,
							recipientID:the_recipient_id
						}
	2. result - the result of the computation, as defined above, per async/non-async calls options
*/

XmpResource.prototype.getRecipientADORs = function(inRecipientID,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/recipients/:recipientID',null,null,this.resourceConfig);

	var parameters = 
		{
			recipientID:inRecipientID !== undefined &&  inRecipientID !== null ? inRecipientID:'login', // note that when using "login", this will be a dummy, as login data will result in retrieving recipient ID
	  		resource:resourceToken(this,inOptions), // note that resourceToken will be valid also if login is done now, as service token will be null
	  												// and so resourceToken = accessToken which is as the REST service expected this to be
			adors:inOptions? inOptions.adors:undefined,
			async:inOptions? inOptions.async:undefined,
			resolved: inOptions? inOptions.resolved:undefined,
			idIsIndex:inOptions? inOptions.idIsIndex:undefined,
			noCache:this.dontCacheGets ? true:undefined	
		}


	var self = this;

	addOptionalLogin(this,inOptions ? inOptions.login:null,parameters);
  	return xmpServer.get(parameters,
						function(value,responseHeaders){
									if(inOptions && inOptions.login)
									{
										if(!self.access)
											self.access = {};
										self.access.serviceToken = value.login.serviceToken;
										self.debug('XmpResource.getRecipientADORs:+login succeeded with input data = ',parameters,'and service token =',value.login.serviceToken);
									}
									else
										self.debug('XmpResource.getRecipientADORs: succeeded with input data = ',parameters);
									if(inRunWhenSuccess)
										inRunWhenSuccess(value,responseHeaders);
								},
						function(httpResponse)
						{
							inRunWhenFailed(httpResponse);
							self.$log.error('XmpResource.getRecipientADORs: failed with input data = ',parameters);
							self.$log.error('XmpResource.getRecipientADORs: httpResponse = ',httpResponse);

						}
						);
}

function addOptionalLogin(self,inLogin,inParameters)
{
	if(inLogin)
	{
		/*
			optional login parameters setup
			/resource/:accessToken/recipients/:id?login=true&&siteURL=THE_PURL&&isTest=IS_TEST&&cachedServiceToken=CACHED_SERVICE_TOKEN&&cachedRecipientID=CACHED_RECIPIENT_ID
		*/
		inParameters.login = true;
		inParameters.siteURL = self.$location.absUrl();
		inParameters.isTest = isTest(self);
		inParameters.cachedServiceToken = inLogin.cached ? inLogin.cached.serviceToken:null;
		inParameters.cachedRecipientID = inLogin.cached ? inLogin.cached.recipientID:null;
	}	
}


XmpResource.prototype.getRecipientsCount = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self = this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/recipients',null,null,this.resourceConfig);
  	return xmpServer.get({count:true,
  							resource:resourceToken(this,inOptions)},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.getRecipientsCount: succeeded with count = ',value);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.getRecipientsCount failed');
								self.$log.error('XmpResource.getRecipientsCount: httpResponse = ',httpResponse);
							});
}

XmpResource.prototype.getRecipientsIDFromIndex = function(inIndex,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self = this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/recipients',null,null,this.resourceConfig);
  	return xmpServer.get({index:inIndex,
  							resource:resourceToken(this,inOptions)},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.getRecipientsIDFromIndex: succeeded for index =',inIndex,'value is =',value);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.getRecipientsIDFromIndex failed');
								self.$log.error('XmpResource.getRecipientsIDFromIndex: httpResponse = ',httpResponse);
							});
}

XmpResource.prototype.getRecipientQueryStatus = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self = this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/asyncquery/:jobID',null,null,this.resourceConfig);
  	return xmpServer.get({jobID:inOptions.jobID,
  							resource:resourceToken(this,inOptions)},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.getRecipientQueryStatus: succeeded with job id = ',inOptions.jobID);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.getRecipientQueryStatus: failed with job id = ',inOptions.jobID);
								self.$log.error('XmpResource.getRecipientQueryStatus: httpResponse = ',httpResponse);
							});
}

XmpResource.prototype.getSchema = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self = this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/schema',null,null,this.resourceConfig);
  	return xmpServer.get({resource:resourceToken(this,inOptions)},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.getSchema: succeeded with options = ',inOptions);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.getSchema: failed with options = ',inOptions);
								self.$log.error('XmpResource.getSchema: httpResponse = ',httpResponse);
							}); 	
}




XmpResource.prototype.getAssetFetchingURL = function(inAssetName,inOptions)
{
	return accessURL(this,inOptions) + '/resource/' + encodeURIComponent(resourceToken(this,inOptions)) + '/assets?resolved=' + encodeURIComponent(inAssetName);
}

XmpResource.prototype.fetchAsset = function(inAssetName,inOptions,inRunWhenFetched,inRunWhenFailed)
{
	return fetchURL(this,this.getAssetFetchingURL(inAssetName,inOptions),inRunWhenFetched,inRunWhenFailed);
}

function fetchURL(self,inURL,inRunWhenFetched,inRunWhenFailed)
{
	var req = self.$http.get(inURL,self.resourceConfig);
	if(inRunWhenFetched)
		req.success(inRunWhenFetched);
	if(inRunWhenFailed)
		req.error(inRunWhenFailed);
	return req;
}

XmpResource.prototype.get = function(url,inRunWhenFetched,inRunWhenFailed)
{
	var req = this.$http.get(url);
	if(inRunWhenFetched)
		req.success(inRunWhenFetched);
	if(inRunWhenFailed)
		req.error(inRunWhenFailed);
	return req;
}

function noOp(){}

XmpResource.prototype.saveRecipientADORs = function(inRecipientID,inAdors,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self = this;	
	var xmpServer = this.$resource(
								accessURL(this,inOptions) + '/resource/:resource/recipients/:recipientID',
								null,
								{'save': {method: 'PUT'}},
								this.resourceConfig);
  	return xmpServer.save({
  								recipientID:inRecipientID,
  								resource:resourceToken(this,inOptions),
  								adors:inOptions? inOptions.retrieveADORs:undefined, // adors for retrieve after udpate
  								resolved:inOptions? inOptions.resolvedADORs:undefined
  							},
  							inAdors,
							function(value,responseHeaders)
							{
								self.debug('XmpResource.saveRecipientADORs: succeeded with recipient id = ',inRecipientID,'and adors =',inAdors);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.saveRecipientADORs: failed with recipient id = ',inRecipientID,'and adors =',inAdors);
								self.$log.error('XmpResource.saveRecipientADORs: httpResponse = ',httpResponse);
							});	
}

XmpResource.prototype.addRecipient = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;

	var self = this;	
	var xmpServer = this.$resource(
								accessURL(this,inOptions) + '/resource/:resource/recipients',
								null,
								{'add': {method: 'POST'}},
								this.resourceConfig);
  	return xmpServer.add({
  							resource:resourceToken(this,inOptions),
  						},
						{
							newRecipientValues:inOptions.adors,
							newRecipientRetrieveADORs:inOptions.retrieveADORs,
							newRecipientResolvedADORs:inOptions.resolvedADORs
						},
						function(value,responseHeaders)
						{
							self.debug('XmpResource.addRecipient: succeeded with values = ',inOptions.adors,'and retrieved adors =',inOptions.retrieveADORs);
							inRunWhenSuccess(value,responseHeaders);
						},  							
						function(httpReponse)
						{
							inRunWhenFailed(httpResponse);
							self.$log.error('XmpResource.addRecipient: failed with values = ',inOptions.adors,'and retrieved adors =',inOptions.retrieveADORs);
							self.$log.error('XmpResource.addRecipient: httpResponse = ',httpResponse);
						}
						);	
}

XmpResource.prototype.addDefaultTrackingParameters = function(inParametersObject)
{
	/*
		Add to inParametersObject some default tracking parameters, such as browser identity, screen resolutions etc.
		[the list is originally from the legacy uCreate XM implementation. made marks here to explain meaning where 
			++, set here, 
			--, should be taken care off by caller, 
			?? will be added by uCreate XM Server for implementation reasons,
			** irrelevant
		]

		-- PageName, (the logical page name provided by user)
		-- ActionName, (the logical name of the event)
		-- ActionParams, (other parameter for the action)
		++ Screen Resolution, (client window resolution)
		++ Browser, (browser name and version)
		++ Platform, (os name and version)
		++ Human Language, (browser language)
		?? ClientIP, (client IP, provided by server according to relevant HTTP headers)
		++ PageURI, (page URL, with no parameters)
		++ ReferringPageURI, (page URL for the page that lead to this page, if relevant. normally for links cliecked on)
		?? UserSession, (server session ID, to track different work sessions)
		++ PageParams, (page query string parameters)
		?? IsLandingPage, (indication for landing page)
		++ Java Enabled, (javascript enabled on page. for this solution it'll alwasy be true)
		** XMPieSourceJobID, (job id for batch email where this page is the email body. legacy email solution not relevant for this solution)
	*/

	inParametersObject['Screen Resolution'] = screen.width + 'x' + screen.height;
	inParametersObject['Browser'] = platform.name + ' ' + platform.version;
	inParametersObject['Platform'] = platform.os.family + ' ' + platform.os.version;
	inParametersObject['Human Language'] = navigator.systemLanguage || navigator.language ||  "Unknown";
	inParametersObject['PageURI'] = this.$location.absUrl().substr(0,this.$location.absUrl().length - this.$location.url().length + this.$location.path().length);
	inParametersObject['ReferringPageURI'] = document.referrer; // for document.referrer to work correctly you need to run the pages from actual server, not using file:/// protocol (dbl click on html web page)
	inParametersObject['PageParams'] = this.$location.url().substr(this.$location.path().length + 1);
	inParametersObject['Java Enabled'] = 'true';
	// mark TBDs for the server to decipher them
	inParametersObject['ISLandingPage'] = 'TBD'; 
	inParametersObject['ClientIP'] = 'TBD'; 
	inParametersObject['UserSession'] = 'TBD';

	return inParametersObject;
}


XmpResource.prototype.trackEvent = function(inEventType,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	/*
		options can have
			recipientID
			access
			sync

			date (otherwise will provide current date)
			properties


			sync is provided so that events can be tracked on page unload. if always using async, than page
			unload will cut the call. 
	*/

  	var parameters = {
						type:inEventType,
						recipientID:inOptions.recipientID,
						date:inOptions.date ? inOptions.date.toUTCString() : (new Date()).toUTCString(),
					};

	if(inOptions && inOptions.properties)
	{
		for(var v in inOptions.properties)
		{
			if(inOptions.properties.hasOwnProperty(v))
				parameters[v] = inOptions.properties[v];
		}
	}

	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;

	var runWhenSuccess = function(value,responseHeaders)
	{
		this.debug('XmpResource.trackEvent: succeeded with parameters = ',parameters);
		inRunWhenSuccess(value,responseHeaders);
	}.bind(this);

	var runWhenFailed = function(httpResponse)
	{
		inRunWhenFailed();
		this.$log.error('XmpResource.trackEvent: failed with parameters = ',parameters);
		this.$log.error('XmpResource.trackEvent: httpResponse = ',httpResponse);
	}.bind(this);

	if(inOptions && inOptions.sync)
	{
		$.ajax({
		  type: 'POST',
		  url: accessURL(this,inOptions) + '/resource/' + encodeURIComponent(resourceToken(this,inOptions)) + '/events',
		  data: JSON.stringify(parameters),
          contentType: "application/json; charset=utf-8",				
		  success: runWhenSuccess,
		  async:false,
		  timeout:this.timeout
		}).fail(runWhenFailed);

	}
	else
	{
		var xmpServer = this.$resource(
									accessURL(this,inOptions) + '/resource/:resource/events',
									null,
									{'add': {method: 'POST'}},
									this.resourceConfig);
	  	return xmpServer.add({
	  							resource:resourceToken(this,inOptions),
	  						},
							parameters,
							runWhenSuccess,
							runWhenFailed
							);	
	}
}

XmpResource.prototype.sendEmail = function(inEmailTouchpointID,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;


	var runWhenSuccess = function(value,responseHeaders)
	{
		this.debug('XmpResource.sendEmail: succeeded with email touchpoint id =',inEmailTouchpointID,'recipient id =',inOptions.recipientID,'customizations =',inOptions.customizations);
		inRunWhenSuccess(value,responseHeaders);
	}.bind(this);

	var runWhenFailed = function(httpResponse)
	{
		inRunWhenFailed(httpResponse);
		this.$log.error('XmpResource.sendEmail: failed with email touchpoint id =',inEmailTouchpointID,'recipient id =',inOptions.recipientID,'customizations =',inOptions.customizations);
		this.$log.error('XmpResource.sendEmail: httpResponse = ',httpResponse);
	}.bind(this);

	if(inOptions && inOptions.sync)
	{
		$.ajax({
		  type: 'POST',
		  url: accessURL(this,inOptions) + '/resource/' + encodeURIComponent(resourceToken(this,inOptions)) + '/emails',
		  data: JSON.stringify({
					emailTouchpointID:inEmailTouchpointID,
					recipientID:inOptions.recipientID,
					customizations:inOptions.customizations
				}),
          contentType: "application/json; charset=utf-8",				
		  success: runWhenSuccess,
		  async:false
		}).fail(runWhenFailed);

	}
	else
	{
		var xmpServer = this.$resource(
									accessURL(this,inOptions) + '/resource/:resource/emails',
									null,
									{'send': {method: 'POST'}},
									this.resourceConfig);
	  	return xmpServer.send({
	  							resource:resourceToken(this,inOptions),
	  						},
							{
								emailTouchpointID:inEmailTouchpointID,
								recipientID:inOptions.recipientID,
								customizations:inOptions.customizations
							},
							runWhenSuccess,
							runWhenFailed);
	}	
}

XmpResource.prototype.getDocuments = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	var self=this;	
	inRunWhenFailed = inRunWhenFailed || noOp;
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/documents',null,null,this.resourceConfig);
  	return xmpServer.get({resource:resourceToken(this,inOptions)},
					function(value,responseHeaders)
					{
						self.debug('XmpResource.getDocuments: succeeded with resource = ',resourceToken(self,inOptions));
						inRunWhenSuccess(value,responseHeaders);
					},  							
					function(httpResponse)
					{
						inRunWhenFailed(httpResponse);
						self.$log.error('XmpResource.getDocuments: failed with resource = ',resourceToken(self,inOptions));
						self.$log.error('XmpResource.getDocuments: httpResponse = ',httpResponse);
					});
}

XmpResource.prototype.getEmailDocuments = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	var self=this;	
	inRunWhenFailed = inRunWhenFailed || noOp;
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/emaildocuments',null,null,this.resourceConfig);
  	return xmpServer.get({resource:resourceToken(this,inOptions)},
					function(value,responseHeaders)
					{
						self.debug('XmpResource.getEmailDocuments: succeeded with resource = ',resourceToken(self,inOptions));
						inRunWhenSuccess(value,responseHeaders);
					},  							
					function(httpResponse)
					{
						inRunWhenFailed(httpResponse);
						self.$log.error('XmpResource.getEmailDocuments: failed with resource = ',resourceToken(self,inOptions));
						self.$log.error('XmpResource.getEmailDocuments: httpResponse = ',httpResponse);
					});
}


XmpResource.prototype.getEmailTouchpoints = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self=this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/emailtouchpoints',null,null,this.resourceConfig);
  	return xmpServer.get({resource:resourceToken(this,inOptions)},
					function(value,responseHeaders)
					{
						self.debug('XmpResource.getEmailTouchpoints: succeeded with resource = ',resourceToken(self,inOptions));
						inRunWhenSuccess(value,responseHeaders);
					},  							
					function(httpResponse)
					{
						inRunWhenFailed(httpResponse);
						self.$log.error('XmpResource.getEmailTouchpoints: failed with resource = ',resourceToken(self,inOptions));
						self.$log.error('XmpResource.getEmailTouchpoints: httpResponse = ',httpResponse);
					});  		
}

XmpResource.prototype.getEmailFooters = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self=this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/emailfooters',null,null,this.resourceConfig);
  	return xmpServer.get({resource:resourceToken(this,inOptions)},
					function(value,responseHeaders)
					{
						self.debug('XmpResource.getEmailFooters: succeeded with resource = ',resourceToken(self,inOptions));
						inRunWhenSuccess(value,responseHeaders);
					},  							
					function(httpResponse)
					{
						inRunWhenFailed(httpResponse);
						self.$log.error('XmpResource.getEmailFooters: failed with resource = ',resourceToken(self,inOptions));
						self.$log.error('XmpResource.getEmailFooters: httpResponse = ',httpResponse);
					});  		
}


XmpResource.prototype.startGenerationJob = function(inDocumentID,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self=this;	

	var xmpServer = this.$resource(
								accessURL(this,inOptions) + '/resource/:resource/generationjobs',
								null,
								{'send': {method: 'POST'}},
								this.resourceConfig);
  	return xmpServer.send({
  							resource:resourceToken(this,inOptions),
  						},
						{
							documentID:inDocumentID,
							recipientID:inOptions.recipientID
						},
						function(value,responseHeaders)
						{
							self.debug('XmpResource.startGenerationJob: succeeded with document id =',inDocumentID,'and recipient ID =',inOptions.recipientID);
							inRunWhenSuccess(value,responseHeaders);
						},  							
						function(httpResponse)
						{
							inRunWhenFailed(httpResponse);
							self.$log.error('XmpResource.startGenerationJob: failed with document id =',inDocumentID,'and recipient ID =',inOptions.recipientID);
							self.$log.error('XmpResource.startGenerationJob: httpResponse = ',httpResponse);
						});
}

XmpResource.prototype.getGenerationJobStatus = function(inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self=this;	
	var xmpServer = this.$resource(accessURL(this,inOptions) + '/resource/:resource/generationjobs/:jobID',null,null,this.resourceConfig);
  	return xmpServer.get({jobID:inOptions.jobID,
  							resource:resourceToken(this,inOptions)},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.getGenerationJobStatus: succeeded with job id = ',inOptions.jobID);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.getGenerationJobStatus: failed with job id = ',inOptions.jobID);
								self.$log.error('XmpResource.getGenerationJobStatus: httpResponse = ',httpResponse);
							});
}

XmpResource.prototype.getGeneratedFileFetchingURL = function(inOptions)
{
	var fileID = (typeof inOptions == 'string') ? inOptions:inOptions.fileID;

	return accessURL(this,inOptions) + '/resource/' + encodeURIComponent(resourceToken(this,inOptions)) + '/generatedfiles/' + encodeURIComponent(fileID);
}

XmpResource.prototype.fetchGeneratedFile = function(inOptions,inRunWhenFetched,inRunWhenFailed)
{
	return fetchURL(this,this.getGeneratedFileFetchingURL(inOptions),inRunWhenFetched,inRunWhenFailed);
}

XmpResource.prototype.changeUnsubscribeStatus = function(inRecipientID,inUnsubscribe,inOptions,inRunWhenSuccess,inRunWhenFailed)
{
	inRunWhenSuccess = inRunWhenSuccess || noOp;
	inRunWhenFailed = inRunWhenFailed || noOp;
	var self=this;	
	var xmpServer = this.$resource(
								accessURL(this,inOptions) + '/resource/:resource/unsubscribe',
								null,
								{'save': {method: 'POST'}},
								this.resourceConfig);
  	return xmpServer.save({
  								resource:resourceToken(this,inOptions)
  							},
  							{
  								status:inUnsubscribe,
  								recipientID:inRecipientID,
  								siteURL:this.$location.absUrl()
  							},
							function(value,responseHeaders)
							{
								self.debug('XmpResource.changeUnsubscribeStatus: succeeded with recipient id =',inRecipientID,'and unsubscribe status =',inUnsubscribe);
								inRunWhenSuccess(value,responseHeaders);
							},  							
  							function(httpResponse)
							{
								inRunWhenFailed(httpResponse);
								self.$log.error('XmpResource.changeUnsubscribeStatus: failed with recipient id =',inRecipientID,'and unsubscribe status =',inUnsubscribe);
								self.$log.error('XmpResource.changeUnsubscribeStatus: httpResponse = ',httpResponse);
							});	
}


/*
	Here starts ADOR names parsing
*/

/*
	populateADORsFromExpression is a general purpose method to figure out ADORs of either recipient
	or referred recipient from an expression, be it text, attribute value or whatnot.
	the input dictionaries are used as sets and will contain the end result of the parsing, each with the matching
	ADORs
*/
XmpResource.prototype.populateRecipientADORsInExpression = function(inExpression,inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient)
{
	/*
		takes any r.XXXX in an angular expression and registers XXXX as an ADOR name
	*/
	// xmp.r.test (allow any non space after)
	var results;

	if(!excludeRecipient)
	{
		results = inExpression.match(/xmp\.r\.[\w]+/g);
		if(results)
		{
			results.forEach(function(inElement)
			{
				inRecipientDictionary[inElement.substring(6)] = true;
			});
		}
		// xmp.r['test'] (allow any by ] after)
		results = inExpression.match(/xmp\.r\[(\"|\')[^\]]+/g);
		if(results)
		{
			results.forEach(function(inElement)
			{
				inRecipientDictionary[inElement.substring(7,inElement.length-1)] = true;
			});
		}
	}

	/*
		add also any referredRecipient.XXXX, for recipient fetch
	*/
	if(!excludeRefer)
	{
		results = inExpression.match(/xmp\.referredRecipient\.[\w]+/g);
		if(results)
		{
			results.forEach(function(inElement)
			{
				inReferredRecipientDictionary[inElement.substring(22)] = true;
			});
		}
		results = inExpression.match(/xmp\.referredRecipient\[(\"|\')[^\]]+/g);
		if(results)
		{
			results.forEach(function(inElement)
			{
				inReferredRecipientDictionary[inElement.substring(23,inElement.length-1)] = true;
			});
		}
	}
}

/*
	This method is specific to initial ADORs retrieval. it parses the ADORs in the expression
	into the default dictionaries defined for getting ADORs
*/
XmpResource.prototype.declareRecipientADORsInExpression = function(inExpression)
{
	this.createDefaultRetrieveDictionaries();
	this.populateRecipientADORsInExpression(inExpression,this.defaultAdorsForGet,this.defaultAdorsForReferredGet);
}


/*
	This method is for initial ador retrieval, but scannning for resolved adors, rather then regular adors
*/
XmpResource.prototype.declareRecipientResolvedADORsInExpression = function(inExpression)
{
	this.createDefaultRetrieveDictionaries();
	this.populateRecipientADORsInExpression(inExpression,this.defaultAdorsForResolve,this.defaultAdorsForReferredResolve);
}


/*
	This method declares ADORs in attributes, keeping away from attributes that are not meant to be interesting.
	This is used either while parsing for ADORs in an element, or specifically parsing ADORs in an element
	that has an attribute that requires other attributes to be parsed, as they are used as parameters
*/

function attributesExcludeCollection(inAttributes)
{
	return  inAttributes['xmpAsync'] !== undefined || 
			inAttributes['xmp-async'] !== undefined ||
			inAttributes['data-xmp-async'] !== undefined ||
			inAttributes['xmpExcludeLoad'] !== undefined ||
			inAttributes['xmp-exclude-load'] !== undefined ||
			inAttributes['data-xmp-exclude-load'] !== undefined;
}

function attributeCanBeCollected(inAttributeName)
{
	return (typeof(inAttributeName) == 'string' &&
			inAttributeName.length > 0 && 
			inAttributeName.charAt(0) != '$' && 
			
			inAttributeName!='xmpLoadAsyncAdor' &&
			inAttributeName!='xmp-load-async-ador' &&
			inAttributeName!='data-xmp-load-async-ador');

}

XmpResource.prototype.declareRecipientADORsInAttributes = function(inAttributes)
{

	this.createDefaultRetrieveDictionaries();
	this.populateRecipientADORsInAttributes(inAttributes,this.defaultAdorsForGet,this.defaultAdorsForReferredGet);
}

XmpResource.prototype.populateRecipientADORsInAttributes = function(inAttributes,inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient,dontCheckForExclusion)
{
	// this method checks for xmpAsync attribute, in which case declaration is not allowed
	if(attributesExcludeCollection(inAttributes))
		return;

	if(!dontCheckForExclusion)
		excludeRefer |= shouldExcludeReferredSearch(inAttributes);

	var self = this;

	// declare all ADORs in any attributes
	angular.forEach(inAttributes,function(value,key){
		if(attributeCanBeCollected(key))
			self.populateRecipientADORsInExpression(value,inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient)});	
}




/*
	declare all ADORs used in an element. The element text content is searched as well as its children
*/

XmpResource.prototype.declareRecipientADORsInJQueryElement = function(inJElement)
{
	this.createDefaultRetrieveDictionaries();
	this.populateRecipientADORsInJQueryElement(inJElement,this.defaultAdorsForGet,this.defaultAdorsForReferredGet);
}

XmpResource.prototype.createDefaultRetrieveDictionaries = function()
{
	if(!this.defaultAdorsForGet)
		this.defaultAdorsForGet = {};
	if(!this.defaultAdorsForReferredGet)
		this.defaultAdorsForReferredGet = {};
	if(!this.defaultAdorsForResolve)
		this.defaultAdorsForResolve = {};
	if(!this.defaultAdorsForReferredResolve)
		this.defaultAdorsForReferredResolve = {};
}

XmpResource.prototype.populateRecipientADORsInJQueryElement = function(inJElement,inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient,dontCheckForExclusion)
{

	// if has attributes collection, parse there [takes care of exclusion internally]
	if(inJElement[0].attributes)
		this.populateRecipientADORsInAttributes(htmlAttrsToPlainKeyValue(inJElement[0].attributes),inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient,dontCheckForExclusion);

	// may want to exclude search for the children (cases of xmpRefer and xmpRegister forms)
	if(inJElement[0].attributes && !dontCheckForExclusion)
		excludeRefer |= shouldExcludeReferredSearch(htmlAttrsToPlainKeyValue(inJElement[0].attributes));


	// if type text or comment, parse the text  (checking comments because of ngRepeat, which may appear in comment)
	if(inJElement[0].nodeType == 3 || inJElement[0].nodeType == 8)
		this.populateRecipientADORsInExpression(inJElement[0].nodeValue,inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient);

	var self = this;

	// now loop on sub contents to recurse
	inJElement.contents().each(function()
	{
		self.populateRecipientADORsInJQueryElement($(this),inRecipientDictionary,inReferredRecipientDictionary,excludeRefer,excludeRecipient,dontCheckForExclusion);
	})		
}

XmpResource.prototype.debug = function()
{
	if(this.debugEnabled) // i'm using internal debug isntead of angulars, so i can update the debug enabling on the fly
		console.debug.apply(console,arguments);
}

XmpResource.prototype.error = function()
{
	this.$log.error.apply(this.$log,arguments);
}

function htmlAttrsToPlainKeyValue(inAttrs)
{
	var result = {};

	$.each(inAttrs, function(i, attrib){
		result[attrib.name] = attrib.value;
	  });

	return result;
}

function shouldExcludeReferredSearch(inAttributes)
{
	if(!inAttributes)
		return false;

	return  inAttributes['xmpRefer'] !== undefined || 
			inAttributes['xmp-refer'] !== undefined ||
			inAttributes['data-xmp-refer'] !== undefined ||
			inAttributes['xmpReferForm'] !== undefined || 
			inAttributes['xmp-refer-form'] !== undefined ||
			inAttributes['data-xmp-refer-form'] !== undefined;
}

/*
	Here end ADOR names parsing methods
*/




var xmpServices = angular.module('xmp.services', ['ngResource']).config(['$httpProvider', function($httpProvider) {
 $httpProvider.interceptors.push('noCacheInterceptor');
}]).factory('noCacheInterceptor', function () {
            return {
                request: function (config) {
                    if(config.method=='GET'){
                        var separator = config.url.indexOf('?') === -1 ? '?' : '&';
                        config.url = config.url+separator+'ieNoCache=' + new Date().getTime();
                    }
                    return config;
               }
           };
    });
 

 /*
	configuration can have:

	access, defining the url and access token for getting xmpie services [object. members are : token and url]
	timeout, defining the http requests timeout
 */
xmpServices.provider('xmpResource', function XmpResourceProvider() {
	var options = null;

	this.configure = function(inOptions)
	{
		 options = inOptions;
	}

	this.$get = ['$resource','$http','$location','$log',
		function xmpResourceFactory($resource,$http,$location,$log)
		{
			return new XmpResource($resource,$http,$location,$log,options);
		}];
});

'use strict';

var xmpApp = angular.module('xmp.app', [
	'xmp.directives',
  	'xmp.controllers',
  	'xmp.services'
])
.config(['xmpResourceProvider', function(inProvider) {
	// 	xmpcfg is defined externally at the site.
    inProvider.configure({
      access:xmpcfg.access,
      timeout:xmpcfg.timeout,
      test:xmpcfg.isTest
    });
}])
.value('appConfig',function(){
									return {
										asyncAttempts:xmpcfg.asyncAttempts,
	                  					asyncWaitTime:xmpcfg.asyncWaitTime
	                  				};
	              				}
);
/*
	xmpResourceDriver is a driver for xmp.services to be used for non angular scenarios.
	It is good for either a scenario where an angular application does not exist on the page, and
	one that does (in which case this code is ran in non-angular controlled parts)

	inInitialization an object with either one of the keys:

	configuration - case of non-angular application, that requires configuration for the underlying service. in this case
					the driver will start its own application object and will use it to drive the resoruce. configuration value is
					and object that matches what one would pass the xmpResourceProvider configuration method (i.e. access data)

	injector -  case of angular application. pass the injector object for the application. This usage (as oppose to the "element" option) is good
				if you want to run code when the application loads. plant the initialization code in the "run" method that you would define on the application
				module, make the call dependent on "$injector" and pass it as the parameter.
				e.g. 
				xmpApp.run(['$injector',function($injector)
				{
				  new xmpResourceDriver({injector:$injector}).getRecipientADORs('gal.kahana',null,function(data){$('#txtArea').val(JSON.stringify(data))});
				}]);

	element - 	  Same as injector case, but pass an element on which one can find an injector (say, the application module). injector will be
					deduced via angular API, on this element. Use this option, as oppose to "injector" if you are positive that at the running point
					the element will already have an injector. a good example is a user interaction.


	by default, it is assumed that element setup exists, and it is on the document HTML object.
*/

var xmpResourceDriver = function(inInitialization,inDoLogin,inDecipherRecipientID)
{

	var self = this;

	if(inInitialization && inInitialization.configuration)
	{
		// non angular application case. init an app, and run the services under it

		angular.module('xmp.app', inDoLogin ? ['xmp.services', 'ngCookies']:['xmp.services']).config(['xmpResourceProvider', function(inProvider) {
		  	inProvider.configure(inInitialization.configuration);
		}]);


	    angular.element(document).ready(function() {
	      	self.injector = angular.bootstrap(document, ['xmp.app']);

	      	init(self,inDoLogin,inDecipherRecipientID);
		});	
	}
	else
	{
		// angular application case. assume app exists, and accept it as input.
		// should be ran only after injector was created, so at this point it should be avialable
		if(inInitialization && inInitialization.element)
			self.injector = angular.element(inInitialization.element).injector();
		else if(inInitialization && inInitialization.injector)
      		self.injector = inInitialization.injector; 
      	else
      		self.injector = angular.element(document).injector();

	  	init(self,inDoLogin,inDecipherRecipientID);
	}
}

function init(self,inDoLogin,inDecipherRecipientID)
{
  	// save instance of xmpResource as  member
  	self.xmpResource = getResource(self,'xmpResource');
  	// cookies are used in login for caching recipient ID and service token
  	if(inDoLogin)
  		self.$cookies = getResource(self,'$cookies');

  	// copy the prototype of xmpResource, to run from this
  	copyRelevantPrototype(self);

  	if(inDoLogin)
  	{
      	// if doing login, execute and marks as ready at the end
   		self.xmpResource.login(self.$cookies.xmpServiceToken,self.$cookies.xmpRecipientID,inDecipherRecipientID).$promise.then(function(value)
	   		{
	   			self.recipientID = value.recipientID;
	   			self.$cookies.xmpServiceToken = value.serviceToken;
	   			self.$cookies.xmpRecipientID = value.recipientID;
	      		markReady(self);
	      	}
   		);

  	}
  	else
  	{
  		// if not doing login, mark as ready now
  		markReady(self);
    }	
}

function markReady(self)
{
  	// trigger ready event
  	self.isReady = true;
  	$(self).trigger('ready');
}

function getResource(self,inName)
{
	return self.injector.get(inName)
}

function isFunction(functionToCheck) {
	var getType = {};
 	return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
}

function copyRelevantPrototype(self)
{
	var proto = Object.getPrototypeOf(self.xmpResource);

	for(var key in proto)
	{
		if(proto.hasOwnProperty(key) && isFunction(proto[key]))
		{
			var obj = {key:key};
			self[key] = function(){
				return self.xmpResource[this.key].apply(self.xmpResource,arguments)
			}.bind(obj);
			
		}
	}
}

/*
	ready method should be used when running code on page load, and not sure whether
	login/resource initial loading happened or not. This method ensures that the code
	will be ran when loading completes
*/
xmpResourceDriver.prototype.ready = function(inCB)
{
	if(this.isReady)
		return inCB.call(this);
	else
		$(this).one('ready',inCB);
}



/*
	xmpControllerDriver is a driver for xmpie controllers.
	it is a simple provider allowing access to the "xmp" data strcuture available
	for the controller scope, and scope.

	also, there's a 'ready' function that will trigger functions when xmpReady on the scope.
	Seems like running from document.ready or later should do the trick.

*/
var xmpControllerDriver = function(inJController)
{
	this.controller = angular.element(inJController);

	Object.defineProperty(this, 'xmp', {
						  get: function(){return this.controller.scope().xmp}
						, enumerable: true
						, configurable: true
					});
	Object.defineProperty(this, 'scope', {
						  get: function(){return this.controller.scope()}
						, enumerable: true
						, configurable: true
					});

}

xmpControllerDriver.prototype.ready = function(inCB)
{
	this.scope.xmpReady(inCB);
}

;
