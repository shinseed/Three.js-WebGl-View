var THREE = require('three'); //threejs不用import方式 是不想webpack 出打包警告提示
var TWEEN = require('tween.js');
import { TrackballControls } from './TrackballControls';
import { WWOBJLoader2 } from './WWOBJLoader2';
import { Octree } from './Octree';

var ZipTools = (function() {

    function ZipTools(path, vue) {
        this.zip = new JSZip();
        this.vue = vue;

        this.fileLoader = new THREE.FileLoader();
        this.fileLoader.setPath(path);
        this.fileLoader.setResponseType('arraybuffer');

        this.zipContent = null;
    }

    ZipTools.prototype.load = function(filename, callbacks) {
        var scope = this;

        var onSuccess = function(zipDataFromFileLoader) {
            scope.zip.loadAsync(zipDataFromFileLoader)
                .then(function(zip) {

                    scope.zipContent = zip;
                    callbacks.success();

                });
        };

        var refPercentComplete = 0;
        var percentComplete = 0;
        var output;
        var onProgress = (event) => {
            if (!event.lengthComputable) return;

            percentComplete = Math.round(event.loaded / event.total * 100);
            if (percentComplete > refPercentComplete) {

                refPercentComplete = percentComplete;

                output = '正在下载  "' + filename + '": ' + percentComplete + '%';
                this.vue.handProcess(output)
                // console.log(output);
                if (Boolean(callbacks.progress)) callbacks.progress(output);

            }
        };

        var onError = function(event) {
            var output = 'Error of type "' + event.type + '" occurred when trying to load: ' + filename;
            console.error(output);
            callbacks.error(output);
        };
        this.vue.handProcess(`开始下载${filename}`)
        this.fileLoader.load(filename, onSuccess, onProgress, onError);
    };

    ZipTools.prototype.unpackAsUint8Array = function(filename, callback) {

        if (JSZip.support.uint8array) {

            this.zipContent.file(filename).async('uint8array')
                .then(function(dataAsUint8Array) {

                    callback(dataAsUint8Array);

                });

        } else {

            this.zipContent.file(filename).async('base64')
                .then(function(data64) {

                    callback(new TextEncoder('utf-8').encode(data64));

                });

        }
    };

    ZipTools.prototype.unpackAsString = function(filename, callback) {
        this.zipContent.file(filename).async('string')
            .then(function(dataAsString) {

                callback(dataAsString);

            });
    };

    return ZipTools;

})();

/**
 * threeview class
 * @class
 */
class Three {
    constructor(canvas, w, h, vue) {
        this.vue = vue;
        //基础属性
        this.canvas = canvas;
        this.camera = null;
        this.controls = null;
        this.scene = null;
        this.width = w;
        this.height = h;
        this.aspectRatio = w / h;
        this.cameraDefaults = {
            posCamera: new THREE.Vector3(0.0, 175.0, 500.0),
            posCameraTarget: new THREE.Vector3(0, 0, 0),
            near: 0.1,
            far: 10000,
            fov: 45
        };
        this.cameraTarget = this.cameraDefaults.posCameraTarget;

        //鼠标点击相关属性
        this.raycaster = null;
        this.mouse = null;
        this.selectModels = [];
        this.visibleModels = [];
        this.isShift = false; //是否多选
        this.isOpacity = true;
        this.isFollow = true;
        this.isSelectColor = false;
        this.renderer = null;
        this.pinObj3D = new THREE.Object3D();
        this.pinObj3D.name = 'pin';

        this.mouseMaterialDefault = new THREE.MeshPhongMaterial({
            color: 0xadf1a7,
            // specular: 0x009900,
            // shininess: 30,
            //  wireframe:true,
            //  wireframeLinewidth:10,
            // flatShading: true
        });


        //模型相关
        this.wwObjLoader2 = new WWOBJLoader2();
        this.wwObjLoader2.setCrossOrigin('anonymous');
        this.octree;
        this.boundMax=null;
        this.boundNow=null;
        this.loadCounter = 0;
        this.objs2Load = [];
        this.allAssets = [];

        //loading
        this.processing = false;
        this.loadCallback = null;

        //clip
        this.clipPlanes = [
            new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
            new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
            new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
        ];
        this.clipParams = {
            clipIntersection: false,
            planeConstant: 0,
            showHelpers: false
        };

        this.init();

        //事件监听
        window.addEventListener('resize',this.resizeDisplayGL.bind(this),false)
        // this.animate();
    }
    init() {
        this.camera = new THREE.PerspectiveCamera(this.cameraDefaults.fov, this.aspectRatio, this.cameraDefaults.near, this.cameraDefaults.far);
        this.resetCamera();
        // world
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        // this.scene.fog = new THREE.FogExp2( 0xcccccc, 0.002 );

        //坐标轴辅助
        var helper = new THREE.GridHelper(1200, 10, 0xFF4444, 0x404040);
        this.scene.add(helper);




        // light
        var light = new THREE.DirectionalLight(0xffffff);
        light.position.set(1, 1, 1);
        this.scene.add(light);
        // var light = new THREE.DirectionalLight(0x002288);
        // light.position.set(-1, -1, -1);
        // this.scene.add(light);
        var light = new THREE.AmbientLight(0x222222);
        this.scene.add(light);

        // create octree
        this.octree = new Octree({
            // when undeferred = true, objects are inserted immediately
            // instead of being deferred until next octree.update() call
            // this may decrease performance as it forces a matrix update
            undeferred: false,
            // set the max depth of tree
            depthMax: Infinity,
            // max number of objects before nodes split or merge
            objectsThreshold: 8,
            // percent between 0 and 1 that nodes will overlap each other
            // helps insert objects that lie over more than one node
            overlapPct: 0.15

            // pass the scene to visualize the octree
        });

        //鼠标移动相关操作
        var geometry = new THREE.CylinderGeometry(0, 20, 100, 3);
        geometry.translate(0, -50, 0);
        geometry.scale(0.1, 0.1, 0.1);
        geometry.rotateX(-Math.PI / 2);
        this.helper = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
        this.helper.visible = false;
        this.scene.add(this.helper);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        // renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.canvas, autoClear: true });
        // this.renderer.clippingPlanes = this.clipPlanes;
        // this.renderer.setPixelRatio( window.devicePixelRatio );
        this.renderer.setSize(this.width, this.height);
        this.renderer.localClippingEnabled = true;
        // this.container = document.getElementById( 'container' );
        // this.container.appendChild( renderer.domElement );
        // this.container.appendChild( stats.dom );
        //
        //
        this.controls = new THREE.TrackballControls(this.camera, this.canvas);


    }
    /**
     * canvasHandleClick - 模型点击事件 todo:if 太多需要优化
     *
     * @param  {type} event description
     * @return {type}       description
     */
    canvasHandleClick(event) {
        if (this.mouseupTime - this.mousedownTime > 500) { //优化视角操作不触发点击模型
            return;
        }
        event.preventDefault();
        //canvas坐标-webgl坐标
        let x = (event.offsetX / this.canvas.width) * 2 - 1;
        let y = -(event.offsetY / this.canvas.height) * 2 + 1;
        this.mouse.x = x;
        this.mouse.y = y;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        let meshesSearch = this.octree.search(this.raycaster.ray.origin, this.raycaster.ray.far, true, this.raycaster.ray.direction);
        // let intersections = this.raycaster.intersectObjects( this.objs2Load[0].pivot.children );
        let intersections = this.raycaster.intersectOctreeObjects(meshesSearch);
        //
        if (intersections.length > 0) {
            intersections.sort((a, b) => { //先排序
                return a.distance - b.distance;
            });
            if (this.isShift) { //是否按住shift多选
                let select;
                for (let i = 0; i < intersections.length; i++) {
                  if (this.boundNow.containsPoint(intersections[i].point)) {
                        select=intersections[i];
                        for (let item of this.selectModels) {
                            if (item == select.object) {
                                return;
                            }
                        }
                        select.object.currenMaterial = select.object.material;
                        if (this.isSelectColor) {
                            select.object.material = this.mouseMaterialDefault;
                        } else {
                          if(select.object.material instanceof Array){
                            select.object.material = select.object.material
                          }
                          else{
                            select.object.material = select.object.material.clone();
                          }
                        }
                        this.selectModels.push(select.object);
                        if (this.isFollow) {
                            this.animateClick(this.controls.object.position, this.controls.target, select)
                        }
                      }
                }
            } else {
                this.selectModels.forEach((item) => {
                    item.material = item.currenMaterial;//还原材质
                });
                let select;
                for (let i = 0; i < intersections.length; i++) { //判断是否被切面
                    if (this.boundNow.containsPoint(intersections[i].point)) {
                        select = intersections[i];
                        this.selectModels = [];
                        select.object.currenMaterial = select.object.material;
                        if (this.isSelectColor) {
                            select.object.material = this.mouseMaterialDefault;
                        } else {
                            if(select.object.material instanceof Array){
                              select.object.material = select.object.material
                            }
                            else{
                              select.object.material = select.object.material.clone();
                            }
                        }
                        this.selectModels.push(select.object);
                        if (this.isFollow) {
                            this.animateClick(this.controls.object.position, this.controls.target, select)
                        }
                        console.log(select);
                        return;
                    }
                }

            }
        } else {
            this.selectModels.forEach((item, index) => {
                item.material = item.currenMaterial;
                // console.log(index);
            })
            this.selectModels = [];

            if (this.isOpacity) {
                this.octree.objects.forEach((item) => {
                    item.material.opacity = 1;
                })
            }

        }
        // console.log(intersections);

    }
    canvasHandleMouseup(event) {
        this.mouseupTime = new Date().getTime();
        event.preventDefault();
    }
    canvasHandleMousedown(event) {
        this.mousedownTime = new Date().getTime();
        event.preventDefault();
    }
    canvasHandleMousemove(event) {
        event.preventDefault();
        let x = (event.offsetX / this.canvas.width) * 2 - 1;
        let y = -(event.offsetY / this.canvas.height) * 2 + 1;
        this.mouse.x = x;
        this.mouse.y = y;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        let meshesSearch = this.octree.search(this.raycaster.ray.origin, this.raycaster.ray.far, true, this.raycaster.ray.direction);
        let intersections = this.raycaster.intersectOctreeObjects(meshesSearch);

        if (intersections.length > 0) {
            let select;
            intersections.sort((a, b) => {
                return a.distance - b.distance;
            });
            for (let i = 0; i < intersections.length; i++) {
                let p = intersections[i].point.clone();
                if (this.boundNow.containsPoint(p)) {
                    select = intersections[i];
                    var n = select.face.normal.clone();
                    n.transformDirection(select.object.matrixWorld);

                    n.multiplyScalar(10);
                    n.add(select.point);
                    this.helper.visible = true;
                    this.helper.lookAt(n);
                    this.helper.position.copy(p);
                    return;
                }

            }

        } else {
            this.helper.visible = false;
        }

    }
    resetCamera() {
        this.camera.position.copy(this.cameraDefaults.posCamera);
        this.cameraTarget.copy(this.cameraDefaults.posCameraTarget);
        this.updateCamera();
    }
    updateCamera() {
        this.camera.aspect = this.aspectRatio;
        this.camera.lookAt(this.cameraTarget);
        this.camera.updateProjectionMatrix();
    }
    initPostGL() {
        var scope = this;

        var reloadAssetsProxy = function() {
            scope.reloadAssets();
        };
        var materialsLoaded = function(materials) {
            var count = Boolean(materials) ? materials.length : 0;
            console.log('Loaded #' + count + ' materials.');
        };
        var meshLoaded = (meshName, bufferGeometry, materials) => {
            // just for demonstration...

        };
        var reportProgress = (text) => {
            this.vue.handProcess(text);
        }
        var errorWhileLoading = function() {
            // just for demonstration...
        };
        this.wwObjLoader2.registerCallbackMaterialsLoaded(materialsLoaded);
        this.wwObjLoader2.registerCallbackMeshLoaded(meshLoaded);
        this.wwObjLoader2.registerCallbackCompletedLoading(reloadAssetsProxy);
        this.wwObjLoader2.registerCallbackProgress(reportProgress);
        this.wwObjLoader2.registerCallbackErrorWhileLoading(errorWhileLoading);

        // this.reloadAssets();

        return true;
    }
    recalcAspectRatio() {
        this.aspectRatio = (this.width === 0) ? 1 : this.width / this.height;
    }
    /**
     * resize canvas
     */
    resizeDisplayGL() {

        this.width=this.canvas.parentElement.offsetWidth;
        this.height=this.canvas.parentElement.offsetHeight;
        this.canvas.style.width=this.width+'px';
        this.canvas.style.height=this.height+'px';
        this.controls.handleResize();


        this.recalcAspectRatio();
        this.renderer.setSize(this.width, this.height, false);

        this.updateCamera();
    }
    clearAllAssests() {
        var ref;
        var scope = this;

        for (var asset in this.allAssets) {
            ref = this.allAssets[asset];

            var remover = function(object3d) {

                if (object3d === ref.pivot) return;

                console.log('Removing ' + object3d.name);
                scope.scene.remove(object3d);

                if (object3d.hasOwnProperty('geometry')) object3d.geometry.dispose();
                if (object3d.hasOwnProperty('material')) {

                    var mat = object3d.material;
                    if (mat.hasOwnProperty('materials')) {

                        var materials = mat.materials;
                        for (var name in materials) {

                            if (materials.hasOwnProperty(name)) materials[name].dispose();

                        }
                    }
                }
                if (object3d.hasOwnProperty('texture')) object3d.texture.dispose();
            };
            scope.scene.remove(ref.pivot);
            ref.pivot.traverse(remover);
            ref.pivot = null;
        }
        this.loadCounter = 0;
        this.allAssets = [];
    }
    updateAssets(objs) {
        this.objs2Load = [];
        this.loadCounter = 0;
        this.processing = true;
        if (Boolean(objs)) {

            var obj2Load;
            var pivot;
            var errors = '';

            for (var i = 0; i < objs.length; i++) {

                obj2Load = objs[i];
                if (!this.allAssets.hasOwnProperty(obj2Load.name)) {

                    pivot = new THREE.Object3D();
                    pivot.position.set(obj2Load.pos.x, obj2Load.pos.y, obj2Load.pos.z);
                    pivot.scale.set(obj2Load.scale, obj2Load.scale, obj2Load.scale);
                    pivot.name = obj2Load.name;
                    let radian = Math.PI / 180 * obj2Load.rotate.angle;
                    let axis = new THREE.Vector3(obj2Load.rotate.x, obj2Load.rotate.y, obj2Load.rotate.z);

                    pivot.rotateOnAxis(axis, radian);
                    obj2Load.pivot = pivot;
                    this.objs2Load.push(obj2Load);
                    this.allAssets[obj2Load.name] = obj2Load;

                } else {

                    errors += obj2Load.name + ' ';

                }

                if (errors !== '') {
                    this.reportProgress('Will not reload: ' + errors);
                }

            }

        }
    }
    reportProgress(text) {
        // console.log(this);
        // document.getElementById('feedback').innerHTML = text;
    }
    reloadAssets() {
        var scope = this;

        if (scope.loadCounter < scope.objs2Load.length) {

            var obj2Load = scope.objs2Load[scope.loadCounter];
            var prepData;
            scope.loadCounter++;


            scope.scene.add(obj2Load.pivot);

            if (Boolean(obj2Load.fileZip)) {

                var zipTools = new ZipTools(obj2Load.pathBase, this.vue);
                var mtlAsString = null;

                var setObjAsArrayBuffer = function(data) {
                    scope.reportProgress('');
                    prepData = new THREE.OBJLoader2.WWOBJLoader2.PrepDataArrayBuffer(
                        obj2Load.name, data, obj2Load.pathTexture, mtlAsString
                    );
                    prepData.setSceneGraphBaseNode(obj2Load.pivot);
                    scope.wwObjLoader2.prepareRun(prepData);
                    scope.wwObjLoader2.run();
                };

                var setMtlAsString = function(data) {
                    mtlAsString = data;
                    scope.reportProgress('Unzipping: ' + obj2Load.fileObj);
                    zipTools.unpackAsUint8Array(obj2Load.fileObj, setObjAsArrayBuffer);
                };

                var doneUnzipping = function() {
                    if (Boolean(obj2Load.fileMtl)) {

                        zipTools.unpackAsString(obj2Load.fileMtl, setMtlAsString);

                    } else {

                        setMtlAsString(null);

                    }
                };

                var errorCase = function(text) {
                    scope.reportProgress(text);
                    scope.processing = false;
                };
                zipTools.load(obj2Load.fileZip, { success: doneUnzipping, progress: scope.reportProgress, error: errorCase });

            } else {

                scope.reportProgress('');
                prepData = new THREE.OBJLoader2.WWOBJLoader2.PrepDataFile(
                    obj2Load.name, obj2Load.pathBase, obj2Load.fileObj, obj2Load.pathTexture, obj2Load.fileMtl
                );
                prepData.setSceneGraphBaseNode(obj2Load.pivot);
                scope.wwObjLoader2.prepareRun(prepData);
                scope.wwObjLoader2.run();

            }
        } else { //当所有模型加载完毕后填充 octree
            this.objs2Load.forEach((item) => {
                item.pivot.children.forEach((child) => {
                    if(child.material instanceof Array){
                      child.material.forEach((materialChild)=>{
                        materialChild.clippingPlanes=this.clipPlanes;
                        materialChild.clipIntersection=this.clipParams.clipIntersection;
                        materialChild.side=THREE.DoubleSide;
                      })
                    }
                    else {
                      child.material.clippingPlanes = this.clipPlanes;
                      child.material.clipIntersection = this.clipParams.clipIntersection;
                      child.material.side = THREE.DoubleSide;
                    }
                    child.geometry.computeBoundingBox();
                    let box=child.geometry.boundingBox.clone();
                    // console.log(box,11111);
                    box.applyMatrix4(child.matrixWorld)
                      // console.log(box,2222);
                    if(!this.boundMax){
                      this.boundMax=box;
                    }
                    else{
                      //求模型的最大边界 todo:应该有更好的方法
                      if(this.boundMax.max.x<box.max.x){
                        this.boundMax.max.x=box.max.x;
                      }
                      if(this.boundMax.max.y<box.max.y){
                        this.boundMax.max.y=box.max.y;
                      }
                      if(this.boundMax.max.z<box.max.z){
                        this.boundMax.max.z=box.max.z;
                      }
                      //求模型的最小边界 todo:应该有更好的方法
                      if(this.boundMax.min.x>box.min.x){
                        this.boundMax.min.x=box.min.x;
                      }
                      if(this.boundMax.min.y>box.min.y){
                        this.boundMax.min.y=box.min.y;
                      }
                      if(this.boundMax.min.z>box.min.z){
                        this.boundMax.min.z=box.min.z;
                      }

                    }
                    this.octree.add(child);
                    // this.meshs.push(child);
                })
            })

            let axes = new THREE.Group();
            this.clipPlanes[0].constant=this.boundMax.max.x;
            this.clipPlanes[1].constant=this.boundMax.max.y;
            this.clipPlanes[2].constant=this.boundMax.max.z;
            this.boundNow=this.boundMax.clone();
            axes.add(new THREE.AxisHelper(10));
            axes.add(new THREE.PlaneHelper(this.clipPlanes[0], 30, 0xff0000));
            axes.add(new THREE.PlaneHelper(this.clipPlanes[1], 30, 0x00ff00));
            axes.add(new THREE.PlaneHelper(this.clipPlanes[2], 30, 0x0000ff));
            axes.visible = true;
            this.scene.add(axes);
            //监听事件
            this.canvas.addEventListener('click', this.canvasHandleClick.bind(this), false);
            this.canvas.addEventListener('mousemove', this.canvasHandleMousemove.bind(this), false);
            this.canvas.addEventListener('mouseup', this.canvasHandleMouseup.bind(this), false);
            this.canvas.addEventListener('mousedown', this.canvasHandleMousedown.bind(this), false);
            window.addEventListener('keydown', this.canvasHadnleKeydown.bind(this), false);
            window.addEventListener('keyup', this.canvasHadnleKeyup.bind(this), false);
            scope.processing = false;
            //执行回调
            this.loadCallback()
        }
    }
    canvasHadnleKeydown(event) {
        var e = event || window.event || arguments.callee.caller.arguments[0];
        if (e && e.keyCode == 16) { // 按 shift
            this.isShift = true;
        }
    }
    canvasHadnleKeyup(event) {
        var e = event || window.event || arguments.callee.caller.arguments[0];
        if (e && e.keyCode == 16) { // 按 shift
            this.isShift = false
        }
    }
    animateClick(oldP, oldT, intersections) {
        let boundCenter;
        if (intersections.object.name == 'pin') {
            boundCenter = intersections.object.position.clone();
        } else {
            boundCenter = intersections.object.geometry.boundingSphere.center.clone();
        }
        let sobj = this.selectModels[this.selectModels.length - 1];
        let boundingSphere = sobj.geometry.boundingSphere;
        this.objs2Load.forEach((item) => {
            if (item.name == sobj.parent.name) {
                item.pivot.children.forEach((child) => {
                    if (child.uuid != sobj.uuid) {
                        if (this.isOpacity) {
                            child.material.transparent = true;
                            child.material.opacity = 0.3;
                        }
                    } else {
                        let radian = Math.PI / 180 * item.rotate.angle;
                        let axis = new THREE.Vector3(item.rotate.x, item.rotate.y, item.rotate.z);
                        boundCenter.applyAxisAngle(axis, radian);
                        boundCenter.x += item.pos.x;
                        boundCenter.y += item.pos.y;
                        boundCenter.z += item.pos.z;
                        if (this.isOpacity) {
                            child.material.transparent = true;
                            child.material.opacity = 1;
                        }
                    }
                })

            }

        })
        this.selectModels.forEach((item) => {
            item.material.transparent = false;
        })
        console.log(this.selectModels);
        var r = boundingSphere.radius;
        var offset = r / Math.tan(Math.PI / 180.0 * this.controls.object.fov * 0.5);
        var vector = new THREE.Vector3(0, 0, 1);
        var dir = vector.applyQuaternion(this.controls.object.quaternion);
        var newPos = new THREE.Vector3();
        dir.multiplyScalar(offset * 1.1);
        newPos.addVectors(boundCenter, dir);
        var that = this;
        var tween = new TWEEN.Tween(oldP)
            .to({
                x: newPos.x,
                y: newPos.y,
                z: newPos.z
            }, 500)
            /**
             * Circular 间接的动画
             * Elastic  弹性动画
             * Exponential 指数动画
             * Back  后退动画
             * Bounce 抖动
             * Sinusoidal 正弦曲线动画
             * Quintic 5次方动画
             * Quartic 4次方
             * Cubic   立方体动画
             * Quadratic 2次方动画*/
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onUpdate(() => {

                that.controls.target = new THREE.Vector3(boundCenter.x, boundCenter.y, boundCenter.z);

            });

        var tween1 = new TWEEN.Tween(oldT)
            .to({
                x: newPos.x,
                y: newPos.y,
                z: newPos.z
            }, 10)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onUpdate(() => {
                that.controls.object.position.set(newPos.x, newPos.y, newPos.z);

            });
        tween.chain(tween1);
        tween.start();
    }
    interfaceLoadObjOrZip(assets, loadCallback) {
        if (!this.processing) {
            this.updateAssets(assets)
            this.reloadAssets()
            this.loadCallback = loadCallback;
        }
    }
    interfaceDrawPin(arrs) {
        this.objs2Load.forEach((item) => {
            item.pivot.children.forEach((child) => {
                let center = child.geometry.boundingSphere.center.clone();
                let radian = Math.PI / 180 * item.rotate.angle;
                let axis = new THREE.Vector3(item.rotate.x, item.rotate.y, item.rotate.z);
                center.applyAxisAngle(axis, radian);
                center.x += item.pos.x;
                center.y += item.pos.y;
                center.z += item.pos.z;

                let geometry = new THREE.CylinderGeometry(0, 10, 100, 12);
                geometry.rotateX(Math.PI / 2);

                // geometry.translate ( 0, -50, 0 );
                geometry.scale(0.2, 0.2, 0.2);
                // geometry.rotateX( -Math.PI / 2 );
                let pin = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
                pin.name = 'pin';
                pin.lookAt(this.controls.object.position);
                pin.position.set(center.x, center.y, center.z);
                this.pinObj3D.add(pin);

                this.octree.add(pin);


            })
            this.scene.add(this.pinObj3D);
        })
    }
    interfaceVisbileSelects() {
        this.selectModels.forEach((item) => {
            item.visible = false;
            this.visibleModels.push(item);
        })
    }
    interfaceShowModels() {
        this.visibleModels.forEach((item) => {
            item.visible = true;
        })
    }
    interfaceEnableFollow() {
        this.isFollow = !this.isFollow;
        this.isSelectColor = !this.isSelectColor;
    }
    interfaceClippingX(val){
      let result;
      let x=(this.boundMax.max.x-this.boundMax.min.x)/100;
      result=this.boundMax.max.x-x*val;
      this.clipPlanes[0].constant=result;
      this.boundNow.min.x=-result;
      console.log(result,this.boundMax);
    }
    interfaceClippingY(val){
      let result;
      let y=(this.boundMax.max.y-this.boundMax.min.y)/100;
      result=this.boundMax.max.y-y*val;
      this.clipPlanes[1].constant=result;
      this.boundNow.max.y=result;
    }
    interfaceClippingZ(val){
      let result;
      let z=(this.boundMax.max.z-this.boundMax.min.z)/100;
      result=this.boundMax.max.z-z*val;
      this.clipPlanes[2].constant=result;
      this.boundNow.max.z=result;
    }
    render() {
        if (!this.renderer.autoClear) this.renderer.clear();

        this.controls.update();

        // this.CameraHelper.update();
        TWEEN.update();

        this.pinObj3D.children.forEach((item) => {
            item.lookAt(this.controls.object.position);
        })

        this.octree.update();

        this.renderer.render(this.scene, this.camera);
    }
}

export default {
    Three
}
