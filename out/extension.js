"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const xml2js = require("xml2js");
let importMappingPromise;
if (vscode.workspace.workspaceFolders) {
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const node_modulesPath = path.join(workspaceFolder.uri.fsPath, 'node_modules');
    importMappingPromise = getImportMapping(node_modulesPath);
}
function activate(context) {
    vscode.workspace.onDidSaveTextDocument(async (document) => {
        // 判断文档的文件扩展名是否为 .xml
        if (path.extname(document.fileName) !== '.xml') {
            return;
        }
        // 获取工作区的根目录
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            return;
        }
        // 构造正则表达式来匹配 res/*/layout/*.xml
        const layoutXmlPattern = new RegExp(`^${workspaceFolder.uri.fsPath}${path.sep}res${path.sep}[^${path.sep}]+${path.sep}layout${path.sep}[^${path.sep}]+\.xml$`.replace(/\\/g, '\\\\'), "g");
        console.log(layoutXmlPattern);
        console.log(document.fileName);
        // 判断文档的文件路径是否匹配正则表达式
        if (layoutXmlPattern.test(document.fileName)) {
            // 在此处添加您想要执行的操作，例如处理 XML 文件
            console.log('处理 XML 文件:', document.fileName);
            generateFiles(document.fileName);
        }
    });
}
exports.activate = activate;
async function generateFiles(layoutXmlFile) {
    console.log('generateFiles()');
    console.log(`layoutXmlFile: ${layoutXmlFile}`);
    const xmlData = fs.readFileSync(layoutXmlFile, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData).catch(err => {
        console.log(err);
    });
    if (!result || Object.keys(result).length === 0) {
        return;
    }
    const rootNode = result[Object.keys(result)[0]];
    const rootNodeClazz = Object.keys(result)[0]; // 通常为 "CompositeView"
    // 添加根节点的propertySetName属性和非叶子节点的layout属性
    modifyXmlNode(rootNode, layoutXmlFile, true);
    const builder = new xml2js.Builder();
    const modifiedXml = builder.buildObject(result);
    // 保存修改后的XML文件
    fs.writeFile(layoutXmlFile, modifiedXml, { encoding: 'utf8' }, (err) => {
        if (err) {
            console.log(err);
        }
    });
    console.log("before flatViewNode time: " + new Date().getTime());
    const flattenedViewNodeMap = flatViewNode(rootNode, rootNodeClazz);
    const flattenedLeafNodeMap = new Map();
    const flattenedNonLeafNodeMap = new Map();
    flattenedViewNodeMap.forEach((value, key) => {
        if (value.isLeaf) {
            flattenedLeafNodeMap.set(key, value);
        }
        else {
            flattenedNonLeafNodeMap.set(key, value);
        }
    });
    console.log("after flatViewNode time: " + new Date().getTime());
    // 检查和修改JSON文件
    checkAndUpdateJsonFile(layoutXmlFile, flattenedNonLeafNodeMap);
    // 检查和修改Theme文件
    checkAndUpdateThemeFiles(layoutXmlFile, flattenedViewNodeMap, rootNode);
    // 生成ViewEvent和ViewBinding类
    generateTsClasses(layoutXmlFile, flattenedViewNodeMap);
}
function flatViewNode(viewNode, clazz, isRoot = true, parent) {
    const resultMap = new Map();
    const { $, ...children } = viewNode;
    const isLeaf = Object.keys(children).length === 0;
    const flattenedNode = {
        id: $.id || "",
        clazz,
        isRoot,
        isLeaf,
        hasLayout: !!$.layout,
        hasPropertySet: !!$.propertySetName,
        propertySetName: $.propertySetName,
        layout: $.layout,
        tag: $.tag,
        children: new Map(),
        parent,
    };
    if ($.id) {
        resultMap.set($.id, flattenedNode);
    }
    for (const childClazz in children) {
        const childNodes = children[childClazz];
        if (Array.isArray(childNodes)) {
            childNodes.forEach(childNode => {
                const childResultMap = flatViewNode(childNode, childClazz, false, flattenedNode);
                childResultMap.forEach((value, key) => {
                    resultMap.set(key, value);
                });
                const id = childNode.$.id;
                if (id) {
                    const childSelf = childResultMap.get(id);
                    if (childSelf) {
                        flattenedNode.children.set(id, childSelf);
                    }
                }
            });
        }
        else {
            const childResultMap = flatViewNode(childNodes, childClazz, false, flattenedNode);
            childResultMap.forEach((value, key) => {
                resultMap.set(key, value);
            });
            const id = childNodes.$.id;
            if (id) {
                const childSelf = childResultMap.get(id);
                if (childSelf) {
                    flattenedNode.children.set(id, childSelf);
                }
            }
        }
    }
    return resultMap;
}
// /**
//  * 为XML中的根节点添加propertySetName属性和非叶子节点添加layout属性。
//  * @param {Object} node - XML节点对象
//  * @param {boolean} isRoot - 表示当前节点是否为根节点
//  */
function modifyXmlNode(node, xmlFilePath, isRoot = false) {
    // 判断节点是否为对象，避免操作无效节点
    if (typeof node !== 'object' || node === null) {
        return;
    }
    if (isRoot && xmlFilePath) {
        node.$.id = path.basename(xmlFilePath, '.xml');
        node.$.propertySetName = node.$.id;
    }
    else {
        node.$.propertySetName = undefined;
    }
    const hasChildren = Object.keys(node).some((key) => key !== '$');
    if (hasChildren || isRoot) {
        node.$.layout = `{layout.${node.$.id}}`;
        // 遍历节点的子节点
        for (const childNodeName in node) {
            if (childNodeName === '$') {
                continue;
            }
            const childNode = node[childNodeName];
            if (Array.isArray(childNode)) {
                childNode.forEach((element) => { modifyXmlNode(element); });
            }
            else {
                modifyXmlNode(childNode);
            }
        }
    }
    else {
        node.$.layout = undefined;
    }
}
async function checkAndUpdateJsonFile(layoutXmlFile, leafNodeMap) {
    // 根据layoutXmlFile的路径找到对应的json文件
    const jsonFile = layoutXmlFile.replace(/\.xml$/, '.json');
    let jsonData;
    try {
        const jsonString = await fs.promises.readFile(jsonFile, 'utf-8');
        if (jsonString === '') {
            // 如果json文件为空，创建一个空的json对象
            jsonData = {};
        }
        else {
            jsonData = JSON.parse(jsonString);
        }
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            // 如果json文件不存在，创建一个空的json对象
            jsonData = {};
        }
        else {
            // 其他错误，如无法读取文件或解析错误，打印错误信息并返回
            console.error(`Error reading or parsing JSON file: ${jsonFile}`, err);
            return;
        }
    }
    // 检查并更新缺失的layout定义
    let hasChanges = false;
    leafNodeMap.forEach((value, key) => {
        if (!jsonData.hasOwnProperty(key)) {
            jsonData[key] = {
                type: 'RelativeLayout',
                params: {}
            };
            hasChanges = true;
        }
        if (jsonData[key].params === undefined) {
            jsonData[key].params = {};
            hasChanges = true;
        }
        if (jsonData[key].type === undefined) {
            jsonData[key].type = 'RelativeLayout';
            hasChanges = true;
        }
        // 遍历子节点，并将子节点的id添加到params
        value.children.forEach((childNode) => {
            const params = jsonData[key].params[childNode.id];
            jsonData[key].params[childNode.id] = params || {};
            hasChanges = true;
        });
    });
    // 保存修改后的json文件
    if (hasChanges) {
        try {
            const jsonString = JSON.stringify(jsonData, null, 4);
            fs.promises.writeFile(jsonFile, jsonString, 'utf-8').catch((err) => {
                console.error(`Error writing JSON file: ${jsonFile}`, err);
            });
        }
        catch (err) {
            console.error(`Error writing JSON file: ${jsonFile}`, err);
        }
    }
}
async function checkAndUpdateThemeFiles(layoutXmlFile, flatViewNodeMap, rootNode) {
    console.log('checkAndUpdateThemeFiles()');
    // 获取主题文件的路径
    const themeFiles = [
        path.join(layoutXmlFile, '..', "..", 'theme', 'default.xml'),
        path.join(layoutXmlFile, '..', "..", 'theme', 'default.light.xml')
    ];
    const propertySetName = rootNode.$.propertySetName;
    if (!propertySetName) {
        return;
    }
    // 遍历每个主题文件
    for (const themeFile of themeFiles) {
        // 检查文件是否存在
        if (!fs.existsSync(themeFile)) {
            // 创建默认文件内容
            const defaultThemeXml = `<?xml version="1.0" encoding="UTF-8"?>\n<theme name="${path.basename(themeFile).split(".")[0]}" extend="hdt">\n
			<property-set name="${propertySetName}">
			</property-set>
			</theme>`;
            fs.writeFileSync(themeFile, defaultThemeXml, { encoding: 'utf8', flag: 'w' });
        }
        // 读取主题文件内容
        const themeXmlData = fs.readFileSync(themeFile, 'utf8');
        // 将XML内容解析为JavaScript对象
        const parser = new xml2js.Parser();
        const themeObject = await parser.parseStringPromise(themeXmlData);
        if (!themeObject.theme) {
            themeObject.theme = { $: { name: path.basename(themeFile).split(".")[0] }, 'property-set': [] };
        }
        const themeNode = themeObject.theme;
        // 更新主题文件中的视图ID部分
        updateThemeObject(themeNode, flatViewNodeMap, propertySetName);
        // 将更新后的JavaScript对象转换回XML内容
        const builder = new xml2js.Builder();
        const updatedThemeXml = builder.buildObject(themeObject);
        // 保存更新后的主题文件内容
        fs.writeFileSync(themeFile, updatedThemeXml, { encoding: 'utf8', flag: 'w' });
    }
}
function updateThemeObject(themeNode, flattenedViewNodeMap, propertySetName) {
    // console.log('updateThemeObject()' + propertySetName + ' ' + flattenedViewNodeMap.size)
    if (!themeNode['property-set']) {
        themeNode['property-set'] = [];
    }
    // 遍历主题对象，找到property-set节点
    let propertySets = themeNode['property-set'];
    let newPropertySet = {
        $: { name: propertySetName }
    };
    if (Array.isArray(propertySets)) {
        const thisPropertySet = propertySets.find((propertySet) => propertySet['$'].name === propertySetName);
        if (!thisPropertySet) {
            propertySets.push(newPropertySet);
        }
        else {
            newPropertySet = thisPropertySet;
        }
    }
    else if (propertySets) {
        const hasThisPropertySet = propertySets['$'].name === propertySetName;
        if (!hasThisPropertySet) {
            propertySets = [propertySets, newPropertySet];
        }
        else {
            newPropertySet = propertySets;
        }
    }
    else {
        propertySets = [newPropertySet];
    }
    // 遍历property-set节点，找到id节点和tag节点
    if (!newPropertySet.id) {
        newPropertySet.id = [];
    }
    if (!newPropertySet.tag) {
        newPropertySet.tag = [];
    }
    if (!Array.isArray(newPropertySet.id)) {
        newPropertySet.id = [newPropertySet.id];
    }
    if (!Array.isArray(newPropertySet.tag)) {
        newPropertySet.tag = [newPropertySet.tag];
    }
    const propertySetIds = newPropertySet.id;
    const propertySetTags = newPropertySet.tag;
    flattenedViewNodeMap.forEach((viewNode) => {
        const existsId = propertySetIds.find((propertySetId) => propertySetId?.$.name === viewNode.id);
        if (!existsId) {
            const idNode = { _: " ", $: { name: viewNode.id } };
            propertySetIds.push(idNode);
        }
        else if (!existsId._) {
            existsId._ = " ";
        }
        const existsTag = propertySetTags.find((propertySetTag) => propertySetTag?.$.name === viewNode.tag);
        if (!existsTag && viewNode.tag) {
            const tagNode = { _: " ", $: { name: viewNode.tag } };
            propertySetTags.push(tagNode);
        }
        else if (existsTag && !existsTag._) {
            existsTag._ = " ";
        }
    });
}
async function generateTsClasses(layoutXmlFile, flattenedViewNodeMap) {
    console.log('generateTsClasses()');
    const classPrefix = path.basename(layoutXmlFile, '.xml')[0].toUpperCase() + path.basename(layoutXmlFile, '.xml').slice(1);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(layoutXmlFile));
    try {
        // Generate ViewBinding class.
        const viewBindingClassName = `${classPrefix}ViewBinding`;
        const viewBindingTsContent = await generateViewBindingClass(flattenedViewNodeMap, viewBindingClassName);
        const viewBindingTsFilePath = path.join(workspaceFolder.uri.fsPath, 'ts', 'presenter', 'viewHelper', `${viewBindingClassName}.ts`);
        if (!fs.existsSync(path.dirname(viewBindingTsFilePath))) {
            fs.mkdirSync(path.dirname(viewBindingTsFilePath), { recursive: true });
        }
        fs.writeFileSync(viewBindingTsFilePath, viewBindingTsContent, { encoding: 'utf8', flag: 'w' });
        // Generate ViewEvent class.
        const viewEventTsContent = await generateViewEventClass(flattenedViewNodeMap, classPrefix);
        const viewEventTsFilePath = path.join(workspaceFolder.uri.fsPath, 'ts', 'presenter', 'viewHelper', `${classPrefix}ViewEvent.ts`);
        if (!fs.existsSync(path.dirname(viewEventTsFilePath))) {
            fs.mkdirSync(path.dirname(viewEventTsFilePath), { recursive: true });
        }
        fs.writeFileSync(viewEventTsFilePath, viewEventTsContent, { encoding: 'utf8', flag: 'w' });
        // Generate createXXXViewBindingAndEvent function.
        const createViewBindingAndEventTsContent = generateCreateViewBindingAndEventFunction(classPrefix);
        const createViewBindingAndEventFunctionName = `create${classPrefix}ViewBindingAndEvent`;
        const createViewBindingAndEventTsFilePath = path.join(workspaceFolder.uri.fsPath, 'ts', 'presenter', 'viewHelper', `${createViewBindingAndEventFunctionName}.ts`);
        if (!fs.existsSync(path.dirname(createViewBindingAndEventTsFilePath))) {
            fs.mkdirSync(path.dirname(createViewBindingAndEventTsFilePath), { recursive: true });
        }
        fs.writeFileSync(createViewBindingAndEventTsFilePath, createViewBindingAndEventTsContent, { encoding: 'utf8', flag: 'w' });
    }
    catch (error) {
        console.error('Error occurred while generating TypeScript classes:', error);
    }
}
async function generateViewBindingClass(flatViewNodeMap, className) {
    console.log('generateViewBindingClass()');
    let importSet = new Set();
    let imports = '';
    let properties = '';
    let constructorBody = '';
    const promises = new Array();
    flatViewNodeMap.forEach((viewNode) => {
        const promsie = new Promise((resolve, reject) => {
            importMappingPromise.then((importMapping) => {
                const viewType = viewNode.clazz;
                const importString = importMapping.get(viewType);
                console.log('importString:', importString);
                if (!importString) {
                    return;
                }
                const viewId = viewNode.id;
                if (!importSet.has(importString)) {
                    imports += importString;
                    importSet.add(importString);
                }
                properties += `    public ${viewId}: ${viewType};\n`;
                constructorBody += `        this.${viewId} = rootView.findViewById('${viewId}') as ${viewType};\n`;
                resolve();
            });
        });
        promises.push(promsie);
    });
    await Promise.all(promises);
    const classContent = `
${imports}
class ${className} {
${properties}
    constructor(rootView: CompositeView) {
${constructorBody}
    }
}

export = ${className};
`;
    return classContent;
}
// 预定义的事件映射表
const eventMapping = {
    ".*View": [
        {
            eventName: 'touchend',
            handlerName: 'TouchEnd',
            params: [
                {
                    name: "event",
                    type: "TouchEvent"
                }
            ]
        },
        {
            eventName: 'touchstart',
            handlerName: 'TouchStart',
            params: [
                {
                    name: "event",
                    type: "TouchEvent"
                }
            ]
        },
        {
            eventName: 'touchmove',
            handlerName: 'TouchMove',
            params: [
                {
                    name: "event",
                    type: "TouchEvent"
                }
            ]
        }
    ]
    // 更多视图类型及其事件可以在此添加
};
async function generateViewEventClass(flattenedViewNodeMap, classNamePrefix) {
    console.log('generateViewEventClass()');
    let eventClassContent = '';
    let imports = `import ${classNamePrefix}ViewBinding = require('./${classNamePrefix}ViewBinding');\n\n`;
    let importSet = new Set();
    const importMapping = await importMappingPromise;
    // 定义事件处理接口
    let methods = '';
    for (const view of flattenedViewNodeMap.values()) {
        for (const key in eventMapping) {
            if (Object.prototype.hasOwnProperty.call(eventMapping, key)) {
                const events = eventMapping[key];
                if (new RegExp(key).test(view.clazz)) {
                    for (const event of events) {
                        methods += `    handle${toCamelCase(view.id, true)}${toCamelCase(event.handlerName, true)}?(${event.params.map(param => `${param.name}: ${param.type}`).join(', ')}): void;\n`;
                        for (const param of event.params) {
                            const importString = importMapping.get(param.type);
                            console.log('importString:', importString);
                            if (!importString) {
                                continue;
                            }
                            if (!importSet.has(importString)) {
                                imports += importString;
                                importSet.add(importString);
                            }
                        }
                    }
                }
            }
        }
    }
    const interfaceString = `export interface ${classNamePrefix}ViewEventHandler {
${methods}
}`;
    eventClassContent += imports + interfaceString + '\n\n';
    // 定义ViewEvent类
    eventClassContent += `export class ${classNamePrefix}ViewEvent {\n`;
    eventClassContent += `    private eventHandler: ${classNamePrefix}ViewEventHandler;\n\n`;
    eventClassContent += `    private viewBinding: ${classNamePrefix}ViewBinding;\n\n`;
    // 构造函数
    eventClassContent += `    constructor(viewBinding: ${classNamePrefix}ViewBinding, eventHandler: ${classNamePrefix}ViewEventHandler) {\n`;
    eventClassContent += `        this.viewBinding = viewBinding;\n`;
    eventClassContent += `        this.eventHandler = eventHandler;\n`;
    eventClassContent += `        this.attachListeners();\n`;
    eventClassContent += '    }\n\n';
    // 添加事件监听器方法
    eventClassContent += '    private attachListeners(): void {\n';
    for (const view of flattenedViewNodeMap.values()) {
        const viewEventType = view.clazz;
        for (const key in eventMapping) {
            if (Object.prototype.hasOwnProperty.call(eventMapping, key)) {
                const element = eventMapping[key];
                if (new RegExp(key).test(viewEventType)) {
                    for (const event of element) {
                        eventClassContent += `        this.viewBinding.${view.id}.on('${event.eventName}', this.eventHandler.handle${toCamelCase(view.id, true)}${toCamelCase(event.handlerName, true)}?.bind(this.eventHandler));\n`;
                    }
                }
            }
        }
    }
    eventClassContent += '    }\n';
    eventClassContent += '}\n\n';
    return eventClassContent;
}
function toCamelCase(inputString, upperCaseFirstLetter = false) {
    // 删除非字母和数字的字符
    const cleanedString = inputString.replace(/[^a-zA-Z0-9]+/g, " ");
    // 将每个单词的首字母大写
    const capitalizedWords = cleanedString.split(" ").map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
    });
    // 转换为驼峰法
    const camelCaseString = capitalizedWords.join("");
    // 根据参数选择是否将首字母大写
    if (upperCaseFirstLetter) {
        return camelCaseString;
    }
    else {
        return camelCaseString.charAt(0).toLowerCase() + camelCaseString.slice(1);
    }
}
/**
 * Generate a createXXXViewBindingAndEvent function based on the rootView.
 * @param rootView The root view from the parsed XML object.
 */
function generateCreateViewBindingAndEventFunction(classPrefix) {
    console.log('generateCreateViewBindingAndEventFunction()');
    const createViewBindingAndEventFunction = `
import CompositeView = require('yunos/ui/view/CompositeView');
import ${classPrefix}ViewBinding = require('./${classPrefix}ViewBinding');
import { ${classPrefix}ViewEvent } from './${classPrefix}ViewEvent';
import { ${classPrefix}ViewEventHandler } from './${classPrefix}ViewEvent';

interface ${classPrefix}ViewAndEventHandler extends ${classPrefix}ViewEventHandler {
    view: CompositeView;
}

function create${classPrefix}ViewBindingAndEvent(viewAndEventHandler: ${classPrefix}ViewAndEventHandler) {
    const viewBinding = new ${classPrefix}ViewBinding(viewAndEventHandler.view);
    const viewEvent = new ${classPrefix}ViewEvent(viewBinding, viewAndEventHandler);

    return {
        viewBinding,
        viewEvent,
    };
}

export = create${classPrefix}ViewBindingAndEvent;
`;
    return createViewBindingAndEventFunction.trim();
}
/**
 * 获取一个node_modules文件夹内的所有模块及其导入路径映射
 * @param {string} nodeModulesPath node_modules文件夹路径
 * @returns {Promise<Map<string, string>>} 返回一个Map, 键是模块名, 值是导入语句
 */
async function getImportMapping(nodeModulesPath) {
    const importMapping = new Map();
    // 广度优先遍历node_modules文件夹, 记录包含package.json的文件夹
    const queue = [nodeModulesPath];
    const foldersWithPackageJson = [];
    while (queue.length > 0) {
        const currentFolder = queue.shift();
        const filesAndFolders = await fs.promises.readdir(currentFolder, { withFileTypes: true });
        let hasPackageJson = false;
        for (const fileOrFolder of filesAndFolders) {
            if (fileOrFolder.isFile() && fileOrFolder.name === 'package.json') {
                hasPackageJson = true;
                foldersWithPackageJson.push(currentFolder);
                break;
            }
        }
        if (!hasPackageJson) {
            for (const fileOrFolder of filesAndFolders) {
                if (fileOrFolder.isDirectory()) {
                    queue.push(path.join(currentFolder, fileOrFolder.name));
                }
            }
        }
    }
    // 递归遍历记录的每一个文件夹, 找到其中的每一个.d.ts文件, 并生成映射
    for (const folder of foldersWithPackageJson) {
        await traverseFolder(folder, folder, importMapping);
    }
    return importMapping;
}
/**
 * 递归遍历文件夹并生成映射
 * @param {string} basePath 基础路径
 * @param {string} currentPath 当前路径
 * @param {Map<string, string>} importMapping 导入映射
 */
async function traverseFolder(basePath, currentPath, importMapping) {
    const filesAndFolders = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const fileOrFolder of filesAndFolders) {
        if (fileOrFolder.isFile() && fileOrFolder.name.endsWith('.d.ts')) {
            const moduleName = fileOrFolder.name.slice(0, -5);
            const relativeImportPath = path.relative(basePath, path.join(currentPath, moduleName)).replace(/\\/g, '/');
            const importStatement = `import ${moduleName} = require("${relativeImportPath}")\n`;
            importMapping.set(moduleName, importStatement);
        }
        else if (fileOrFolder.isDirectory()) {
            await traverseFolder(basePath, path.join(currentPath, fileOrFolder.name), importMapping);
        }
    }
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map