"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XmlProcessor = void 0;
const fs = require("fs");
const path = require("path");
const xml2js_1 = require("xml2js");
const xmldom_1 = require("xmldom");
// 此处将包含 xmlProcessor.ts 的具体实现
class XmlProcessor {
    async addLayoutAndPropertySet(xmlFilePath) {
        // 检查文件路径是否符合 res/*/layout/*.xml
        const pathSegments = xmlFilePath.split(path.sep);
        if (pathSegments.length < 3 ||
            pathSegments[pathSegments.length - 3] !== 'res' ||
            pathSegments[pathSegments.length - 2] !== 'layout') {
            return;
        }
        // 读取 XML 文件内容
        const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
        try {
            // 解析 XML 文件
            const xmlObj = await (0, xml2js_1.parseStringPromise)(xmlContent);
            // 添加 layout 和 propertySetName 属性
            xmlObj.$.propertySetName = xmlObj.$.propertySetName || xmlObj.$.id;
            this.processNode(xmlObj);
            // 将修改后的 XML 对象转换回字符串
            const builder = new xml2js_1.Builder();
            const updatedXmlContent = builder.buildObject(xmlObj);
            // 保存修改后的 XML 文件
            fs.writeFileSync(xmlFilePath, updatedXmlContent);
        }
        catch (error) {
            console.error(`Error processing XML file: ${xmlFilePath}`, error);
        }
    }
    processNode(node) {
        // 检查节点是否包含子节点
        const hasChildren = Object.keys(node).some((key) => Array.isArray(node[key]));
        if (hasChildren) {
            // 为非叶子节点添加 layout 和 propertySetName 属性
            node.$ = node.$ || {};
            node.$.layout = node.$.layout || `{layout.${node.$.id}}`;
            // 递归处理子节点
            Object.values(node).forEach((children) => {
                if (Array.isArray(children)) {
                    children.forEach((child) => this.processNode(child));
                }
            });
        }
    }
    async generateLayoutJson(xmlFilePath) {
        // 实现根据 xml 文件生成 json 文件的基本格式的功能
    }
    async generateThemeXml(xmlFilePath) {
        // 实现根据 xml 文件生成 theme.xml 的基本格式的功能
    }
    /**
     * 根据 XML 文件生成 Presenter 基类文件
     * @param xmlFilePath XML 文件路径
     */
    async generatePresenterBaseFile(xmlFilePath) {
        try {
            // 检查文件路径是否符合 res/*/layout/*.xml 格式
            const pathMatch = xmlFilePath.match(/(.*)\/res\/(.+)\/layout\/(.+)\.xml/);
            if (!pathMatch) {
                console.warn(`generatePresenterBaseFile: Invalid file path: ${xmlFilePath}`);
                return;
            }
            // 读取 XML 文件内容
            const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
            // 解析 XML 文件内容
            const parser = new xmldom_1.DOMParser();
            const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
            // 检查解析后的 XML 文档是否包含错误
            const parserErrors = xmlDoc.getElementsByTagName('parsererror');
            if (parserErrors.length > 0) {
                console.error(`generatePresenterBaseFile: Error parsing XML: ${xmlFilePath}`);
                return;
            }
            // 生成 Presenter 基类文件内容
            const presenterBaseContent = generatePresenterBaseContent(xmlDoc, path.basename(xmlFilePath, '.xml'));
            // 保存生成的 Presenter 基类文件到指定目录
            const outputDir = `ts/presenter/base_with_view_and_event`;
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const outputFilePath = path.join(outputDir, `${pathMatch[2]}BasePresenterWithViewAndEvent.ts`);
            fs.writeFileSync(outputFilePath, presenterBaseContent, 'utf-8');
        }
        catch (error) {
            console.error(`generatePresenterBaseFile: Error processing file: ${xmlFilePath}`, error);
        }
    }
}
exports.XmlProcessor = XmlProcessor;
function generatePresenterBaseContent(xmlDoc, xmlFileName) {
    // 根据 XML 文件名生成类名
    const className = xmlFileName
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('') + 'BasePresenterWithViewAndEvent';
    // 获取 XML 中的所有视图节点
    const viewNodes = xmlDoc.getElementsByTagName('*');
    const viewObjects = [];
    for (let i = 0; i < viewNodes.length; i++) {
        const viewNode = viewNodes[i];
        const viewId = viewNode.getAttribute('id');
        if (viewId) {
            const viewType = viewNode.tagName;
            viewObjects.push({ id: viewId, type: viewType });
        }
    }
    // 生成 import 语句
    const importStatements = generateImportStatements(viewObjects);
    // 生成视图对象声明和事件监听方法
    const viewDeclarationsAndEventHandlers = viewObjects
        .map(viewObj => {
        const variableName = viewObj.id;
        const typeName = viewObj.type;
        const eventHandlers = generateEventHandlers(variableName);
        return `
                protected ${variableName}: ${typeName};

                ${eventHandlers}
            `;
    })
        .join('\n');
    // 生成 Presenter 基类文件内容
    const presenterBaseContent = `
        ${importStatements}

        abstract class ${className} extends Presenter {
            ${viewDeclarationsAndEventHandlers}
        }

        export = ${className};
    `;
    return presenterBaseContent;
}
function generateImportStatements(viewObjects) {
    const uniqueViewTypes = Array.from(new Set(viewObjects.map(viewObj => viewObj.type)));
    return uniqueViewTypes
        .map(viewType => `import ${viewType} = require("yunos/ui/view/${viewType}");`)
        .join('\n');
}
function generateEventHandlers(variableName) {
    // 这里列出了每个视图类的 viewEvents，以及相应的回调参数类型
    // 注意：这个对象需要根据具体需求进行更新
    const viewEvents = {
        'Button': [
            { event: 'click', callbackArgType: 'MouseEvent' }
        ],
        'SpriteView': [
            { event: 'touchend', callbackArgType: 'TouchEvent' }
        ]
    };
    return viewEvents[variableName]
        .map(eventObj => {
        const eventName = eventObj.event;
        const callbackArgType = eventObj.callbackArgType;
        const methodName = 'on' + variableName.charAt(0).toUpperCase() + variableName.slice(1) + eventName.charAt(0).toUpperCase() + eventName.slice(1);
        return `
                protected abstract ${methodName}(event: ${callbackArgType}): void;
            `;
    })
        .join('\n');
}
//# sourceMappingURL=xmlProcessor.js.map