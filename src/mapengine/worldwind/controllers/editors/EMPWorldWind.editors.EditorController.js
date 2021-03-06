var EMPWorldWind = EMPWorldWind || {};
EMPWorldWind.editors = EMPWorldWind.editors || {};

/**
 * @classdesc The EditorController handles all drawing, editing, and updating of features
 * @class
 */
EMPWorldWind.editors.EditorController = (function() {
  /**
   * @param {emp.typeLibrary.Feature} feature
   * @param {object} modifiers
   * @param {SelectionStyle} selectionStyle
   * @returns {WorldWind.Placemark}
   * @private
   */
  function _constructSinglePointMilStdSymbol(feature, modifiers, selectionStyle) {
    var placemark, attributes, highlightAttributes, position, imageInfo, imageCenter, imageBounds, imageOffset,
      selectedImage,
      eyeDistanceScaling = false;

    attributes = new WorldWind.PlacemarkAttributes();

    // TODO pass in leaderline settings by feature or via config object
    // Leaderline settings
    attributes.drawLeaderLine = true;
    attributes.leaderLineAttributes.outlineColor = WorldWind.Color.RED;

    // Render
    imageInfo = armyc2.c2sd.renderer.MilStdIconRenderer.Render(feature.symbolCode, modifiers);
    imageCenter = imageInfo.getCenterPoint();
    imageBounds = imageInfo.getImageBounds();

    // Calculate offset
    imageOffset = new WorldWind.Offset(
      WorldWind.OFFSET_FRACTION, imageCenter.x / imageBounds.width,
      WorldWind.OFFSET_FRACTION, 1 - (imageCenter.y / imageBounds.height)
    );

    attributes.imageScale = 1;
    attributes.imageOffset = imageOffset;
    attributes.imageSource = imageInfo.toDataUrl();

    // Highlight attributes
    highlightAttributes = new WorldWind.PlacemarkAttributes();
    highlightAttributes.imageColor = WorldWind.Color.WHITE;
    highlightAttributes.imageOffset = imageOffset;

    // Note that this is done statically, if the selection style changes a bulk update to every feature will need to be done
    modifiers.LINECOLOR = selectionStyle.lineColor;
    modifiers.FILLCOLOR = selectionStyle.fillColor;
    selectedImage = armyc2.c2sd.renderer.MilStdIconRenderer.Render(feature.symbolCode, modifiers).toDataUrl();
    highlightAttributes.imageSource = selectedImage;

    position = new WorldWind.Position(
      feature.data.coordinates[1],
      feature.data.coordinates[0],
      EMPWorldWind.utils.defined(feature.data.coordinates[2]) ? feature.data.coordinates[2] : 0);

    placemark = new WorldWind.Placemark(position, eyeDistanceScaling);
    placemark.alwaysOnTop = true;
    placemark.altitudeMode = feature.properties.altitudeMode || WorldWind.CLAMP_TO_GROUND;
    placemark.attributes = new WorldWind.PlacemarkAttributes(attributes);
    placemark.highlightAttributes = new WorldWind.PlacemarkAttributes(highlightAttributes);

    return placemark;
  }

  /**
   *
   * @param {emp.typeLibrary.Feature} feature
   * @param {object} modifiers
   * @param {SelectionStyle} selectionStyle
   * @returns {WorldWind.SurfaceShape[]}
   * @private
   */
  function _constructMultiPointMilStdFeature(feature, modifiers, selectionStyle) {
    var imageInfo, componentFeature, lineCount, subGeoJSON, bbox, bounds, scale, featureCoords,
      i, j,
      positions = "",
      shapes = [];

    // Generate position string
    featureCoords = feature.data.coordinates.join().split(",");
    for (i = 0; i < featureCoords.length; i += 2) {
      positions += featureCoords[i] + "," + featureCoords[i + 1] + " ";
    }
    positions = positions.trim();

    // Convert bounds to bbox
    bounds = this.getBounds();
    bbox = bounds.west + "," + bounds.south + "," + bounds.east + "," + bounds.north;

    // Calculate the approximate scale
    scale = EMPWorldWind.utils.boundsWidth(bounds) >> 2;

    // TODO get update to renderer to pass back raw JSON object
    imageInfo = JSON.parse(sec.web.renderer.SECWebRenderer.RenderSymbol(
      feature.name,
      feature.coreId,
      feature.description,
      feature.symbolCode,
      positions,
      WorldWind.CLAMP_TO_GROUND,
      scale,
      bbox,
      modifiers,
      EMPWorldWind.constants.MultiPointRenderType.GEOJSON));

    // Generate primitives from the geoJSON
    for (i = 0; i < imageInfo.features.length; i++) {
      componentFeature = imageInfo.features[i];
      switch (componentFeature.geometry.type) {
        case "MultiLineString":
          lineCount = componentFeature.geometry.coordinates.length;

          for (j = 0; j < lineCount; j++) {
            subGeoJSON = {
              properties: componentFeature.properties,
              coordinates: componentFeature.geometry.coordinates[j]
            };

            shapes.push(EMPWorldWind.editors.primitiveBuilders.constructSurfacePolylineFromGeoJSON(subGeoJSON, selectionStyle));
          }
          break;
        case "LineString":
          shapes.push(EMPWorldWind.editors.primitiveBuilders.constructSurfacePolylineFromGeoJSON(componentFeature, selectionStyle));
          break;
        case "Point":
          shapes.push(EMPWorldWind.editors.primitiveBuilders.constructTextFromGeoJSON(componentFeature, selectionStyle));
          break;
        case "Polygon":
          shapes.push(EMPWorldWind.editors.primitiveBuilders.constructSurfacePolygonFromGeoJSON(componentFeature, selectionStyle));
          break;
        default:
          window.console.error("Unable to render symbol with type " + componentFeature.geometry.type);
      }
    }

    return shapes;
  }

  /**
   * Requires access to the current scope ie .bind .call .apply
   *
   * @param {emp.typeLibrary.Feature} feature
   */
  function processModifiers(feature) {
    var modifiers, enhancedModifiers, override;
    if (feature.data.type === "Point") {
      modifiers = EMPWorldWind.utils.milstd.updateModifierLabels(feature.properties, feature.name, this.state.labelStyles, this.state.pixelSize);
    } else {
      modifiers = EMPWorldWind.utils.milstd.updateModifierLabels(feature.properties, feature.name, {}, this.state.pixelSize);
    }

    modifiers = EMPWorldWind.utils.milstd.convertModifierStringTo2525(modifiers, this.state.labelStyles.CN === true);

    enhancedModifiers = EMPWorldWind.utils.milstd.checkForRequiredModifiers(feature);

    for (override in enhancedModifiers) {
      if (enhancedModifiers.hasOwnProperty(override)) {
        modifiers[override] = enhancedModifiers[override];
      }
    }

    return modifiers;
  }

  /**
   * Requires access to the current scope.
   * ie .bind .call .apply
   *
   * @param {emp.typeLibrary.Feature} feature
   * @param {SelectionStyle} selectionStyle
   * @returns {WorldWind.SurfaceShape[]}
   */
  function constructMilStdSymbol(feature, selectionStyle) {
    var modifiers, shapes = [];

    // Process the modifiers
    modifiers = processModifiers.call(this, feature);

    if (feature.data.type === "Point") {
      shapes.push(_constructSinglePointMilStdSymbol(feature, modifiers, selectionStyle));
    } else if (feature.data.type === "LineString") {
      // Requires access to the WorldWindow navigator, bind to the current scope
      shapes = shapes.concat(_constructMultiPointMilStdFeature.call(this, feature, modifiers, selectionStyle));
    } else {
      window.console.error("Unhandled feature type: " + feature.data.type + " in EMPWorldWind");
    }

    return shapes;
  }

  /**
   * Async function
   * @param {emp.classLibrary.Feature} feature
   * @param {PlotFeatureCB} callback
   * @this EMPWorldWind.map
   */
  function asyncPlotKMLFeature(feature, callback) {
    var url, kmlFilePromise, kmlLayer, wwFeature,
      rc = {
        success: false
      };

    // Convert the kml string to a data url
    url = "data:text/xml," + encodeURIComponent(feature.data);

    // Build the KML file promise
    kmlFilePromise = new WorldWind.KmlFile(url);
    kmlFilePromise
      .then(function(kmlFile) {
        // Construct the KML layer to hold the document
        kmlLayer = new WorldWind.RenderableLayer(feature.coreId);

        // Add the KML layer to the map
        kmlLayer.addRenderable(kmlFile);
        this.worldWindow.addLayer(kmlLayer);

        // Use the standard data holder to keep track of the layer
        wwFeature = new EMPWorldWind.data.EmpFeature(feature, this.state.labelStyles);
        wwFeature.addShapes(kmlLayer); // This isn't a WW primitive but use it as if it was

        // Record the layer so we can remove/modify it later
        this.layers[feature.coreId] = kmlLayer;

        // Configure the callback args
        rc.success = true;
        rc.feature = wwFeature;

        // Fire the callback
        callback(rc);
      }.bind(this));
  }

  return {
    /**
     * Creates a new EMPWorldWind feature and associated WorldWind features from an EMP feature and adds it to the map
     *
     * @param {emp.typeLibrary.Feature} empFeature
     * @param {PlotFeatureCB} callback Callback to be invoked on completion
     * @this EMPWorldWind.map
     */
    plotFeature: function(empFeature, callback) {
      var wwFeature, layer, buildShapes, shapes;

      var rc = {
        message: "",
        success: true,
        feature: undefined
      };

      switch (empFeature.format) {
        case emp3.api.enums.FeatureTypeEnum.GEO_ACM:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructAirControlMeasure;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_CIRCLE:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructSurfaceCircle;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_ELLIPSE:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructSurfaceEllipse;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_MIL_SYMBOL:
          buildShapes = constructMilStdSymbol.bind(this);
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_PATH:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructSurfacePolyline;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_POINT:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructPlacemark;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_POLYGON:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructSurfacePolygon;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_RECTANGLE:
        case emp3.api.enums.FeatureTypeEnum.GEO_SQUARE:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructSurfaceRectangle;
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_TEXT:
          buildShapes = EMPWorldWind.editors.primitiveBuilders.constructText;
          break;
        case emp3.api.enums.FeatureTypeEnum.KML:
          // KML is not supported as native primitives in WorldWind
          // TODO KML selection, not sure how to support it or represent it
          return asyncPlotKMLFeature.call(this, empFeature, callback);
        default:
          rc.success = false;
          rc.message = "Missing feature constructor for format: " + empFeature.format;
      }

      // Check if we have a builder for standard primitives
      if (!rc.success) {
        callback(rc);
        return;
      }

      // construct the feature
      wwFeature = new EMPWorldWind.data.EmpFeature(empFeature, this.state.labelStyles);

      // Build the primitives
      shapes = buildShapes(empFeature, this.state.selectionStyle);
      wwFeature.addShapes(shapes);

      // Add the feature to the layer
      layer = this.getLayer(empFeature.parentCoreId);
      layer.addFeature(wwFeature);

      // Configure the callback params
      rc.feature = wwFeature;
      rc.success = true;

      // Fire the callback
      callback(rc);
    },
    /**
     * Updates a WorldWind Renderable object on the map and returns the updated objects in the response
     * @param {EMPWorldWind.data.EmpFeature} wwFeature
     * @param {emp.typeLibrary.Feature} empFeature
     * @param {PlotFeatureCB} callback
     * @this EMPWorldWind.map
     */
    updateFeature: function(wwFeature, empFeature, callback) {
      var layer,
        rc = {
          success: true,
          message: "",
          feature: wwFeature
        };

      // Remove existing primitives from the map
      if (empFeature.format !== emp3.api.enums.FeatureTypeEnum.KML) {
        layer = this.getLayer(empFeature.parentCoreId);
        layer.removeFeature(wwFeature);
      } else {
        // Handle KML
        this.worldWindow.removeLayer(this.layers[empFeature.coreId]);
      }

      // Clear the primitives from the feature
      wwFeature.clearShapes();

      switch (empFeature.format) {
        case emp3.api.enums.FeatureTypeEnum.GEO_MIL_SYMBOL:
          wwFeature.addShapes(constructMilStdSymbol.call(this, empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_ACM:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructAirControlMeasure(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_CIRCLE:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructSurfaceCircle(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_ELLIPSE:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructSurfaceEllipse(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_PATH:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructSurfacePolyline(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_POINT:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructPlacemark(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_POLYGON:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructSurfacePolygon(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_RECTANGLE:
        case emp3.api.enums.FeatureTypeEnum.GEO_SQUARE:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructSurfaceRectangle(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_TEXT:
          wwFeature.addShapes(EMPWorldWind.editors.primitiveBuilders.constructText(empFeature, this.state.labelStyles));
          break;
        case emp3.api.enums.FeatureTypeEnum.KML:
          // KML is not supported as native primitives in WorldWind
          return asyncPlotKMLFeature.call(this, empFeature, callback);
        default:
          rc.success = false;
          rc.message = "Missing feature constructor for format: " + empFeature.format;
      }

      // Redraw the new shapes
      if (rc.success) {
        layer.addFeature(wwFeature);
        rc.feature = wwFeature;
      }

      callback(rc);
    }

    ,
    /**
     *
     * @param {EMPWorldWind.data.EmpFeature} wwFeature
     * @this EMPWorldWind.map
     */
    updateFeatureLabelStyle: function(wwFeature) {
      var shapes,
        empLayer = this.getLayer(wwFeature.feature.parentCoreId);

      switch (wwFeature.feature.format) {
        case emp3.api.enums.FeatureTypeEnum.GEO_MIL_SYMBOL:
          empLayer.removeFeature(wwFeature);
          wwFeature.clearShapes();
          shapes = constructMilStdSymbol.call(this, wwFeature.feature, this.state.selectionStyle);
          wwFeature.addShapes(shapes);
          empLayer.addFeature(wwFeature);
          break;
        case emp3.api.enums.FeatureTypeEnum.GEO_ACM:
        case emp3.api.enums.FeatureTypeEnum.GEO_CIRCLE:
        case emp3.api.enums.FeatureTypeEnum.GEO_ELLIPSE:
        case emp3.api.enums.FeatureTypeEnum.GEO_PATH:
        case emp3.api.enums.FeatureTypeEnum.GEO_POINT:
        case emp3.api.enums.FeatureTypeEnum.GEO_POLYGON:
        case emp3.api.enums.FeatureTypeEnum.GEO_RECTANGLE:
        case emp3.api.enums.FeatureTypeEnum.GEO_SQUARE:
        case emp3.api.enums.FeatureTypeEnum.GEO_TEXT:
        default:
        // do nothing
      }
    }
  };
})
();
