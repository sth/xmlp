// Copyright 2020 Masataka Kurihara. All rights reserved. MIT license.

export class QName {
    private _qName: string;
    protected _prefix: string;
    protected _localPart: string;

    constructor(qName: string) {
        this._qName = qName;
        const i = qName.indexOf(':');
        const q = i < 0 ? [ '', qName ] : qName.split(':');
        this._prefix = q[0];
        this._localPart = q[1];
    }

    get qName(): string {
        return this._qName;
    }

    get prefix(): string {
        return this._prefix;
    }

    get localPart(): string {
        return this._localPart;
    }
}

export class Attribute extends QName {
    uri?: string;
    value = '';

    constructor(qName: string) {
        super(qName);
        if (qName === 'xmlns') {
            this._prefix = 'xmlns';
            this._localPart = '';
        }
    }
}

export class Element extends QName {
    private _attributes: Attribute[] = [];
    private _parent?: Element;

    innerXMLToken: CollectionToken | null = null;

    uri?: string;
    emptyElement = false;

    constructor(name: string, parent?: Element) {
        super(name);
        this._parent = parent;
    }

    get parent(): Element | undefined {
        return this._parent;
    }

    newAttribute(qName: string) {
        const attribute = new Attribute(qName);
        this._attributes.push(attribute);
    }

    peekAttribute(): Attribute | undefined {
        const i = this._attributes.length - 1;
        if (i < 0) {
            return undefined;
        }
        return this._attributes[i];
    }

    get attributes(): Attribute[] {
        return this._attributes;
    }

    get prefixMappings(): { ns: string, uri: string }[] {
        const filterd = this._attributes.filter((attr) => (attr.prefix === 'xmlns'));
        return filterd.map((attr) => ({ ns: attr.localPart, uri: attr.value }));
    }
}

/** information of parsed attribute, readonly. */
export class AttributeInfo extends QName {
    private _attribute: Attribute;

    constructor(attribute: Attribute) {
        super(attribute.qName);
        if (attribute.qName === 'xmlns') {
            this._prefix = 'xmlns';
            this._localPart = '';
        }
        this._attribute = attribute;
    }

    get uri(): string | undefined {
        return this._attribute.uri;
    }

    get value(): string {
        return this._attribute.value;
    }
}

/** information of parsed element, readonly. */
export class ElementInfo extends QName {
    private _element: Element;

    constructor(element: Element) {
        super(element.qName);
        this._element = element;
    }

    get uri(): string | undefined {
        return this._element.uri;
    }

    get parent(): ElementInfo | undefined {
        const parent = this._element.parent;
        if (parent) {
            return new ElementInfo(parent);
        }
        return undefined;
    }

    get attributes(): AttributeInfo[] {
        return this._element.attributes.map((attribute) => {
            return new AttributeInfo(attribute);
        });
    }

    get emptyElement(): boolean {
        return this._element.emptyElement;
    }
}

export interface XMLPosition {
    line: number;
    column: number;
}

export interface XMLLocator {
    position: XMLPosition;
}

class CollectionState {
    pending: number = 0;
    data: string;
    dataIndex: number;

    constructor(data: string, dataIndex: number) {
        this.data = data;
        this.dataIndex = dataIndex;
    }
}

export class CollectionToken {
    readonly startOffset: number;

    constructor(startOffset: number) {
        this.startOffset = startOffset;
    }
}

export class XMLParseContext {
    private _locator?: XMLLocator;
    private _memento = '';
    private _elementStack: Element[] = [];
    private _namespaces: { [ns: string]: string | undefined } = {};
    private _collect: CollectionState | null = null;

    quote: '' | '"' | '\'' = '';
    state = 'BEFORE_DOCUMENT';

    constructor(locator?: XMLLocator) {
        this._locator = locator;
    }

    get position(): XMLPosition {
        return this._locator?.position || { line: -1, column: -1 };
    }

    appendMemento(value: string) {
        this._memento += value;
    }

    clearMemento() {
        this._memento = '';
    }

    get memento(): string {
        return this._memento;
    }

    newElement(qName: string) {
        const parent = this.peekElement();
        this._elementStack.push(new Element(qName, parent));
    }

    peekElement(): Element | undefined {
        return this._elementStack[this._elementStack.length - 1];
    }

    popElement(): Element | undefined {
        const element = this._elementStack.pop();
        element?.prefixMappings.forEach(({ns}) => {
            this._namespaces[ns] = undefined;
        })
        return element;
    }

    get elementLength(): number {
        return this._elementStack.length;
    }

    registerNamespace(ns: string, uri: string) {
        this._namespaces[ns] = uri;
    }

    getNamespaceURI(ns: string): string | undefined {
        return this._namespaces[ns];
    }

    collectInnerXMLStart(element_: ElementInfo, chunk: string, index: number) {
        if (element_.emptyElement) {
            // Self-closing elements don't have innerXML
            return;
        }
        if (this._collect === null) {
            this._collect = new CollectionState(chunk, index);
        }
        const parserElement = this.peekElement();
        if (parserElement === undefined) {
            throw new Error('No current element');
        }
        if (parserElement.innerXMLToken !== null) {
            // Already collecting, ignore duplicate call
            return;
        }
        this._collect.pending += 1;
        parserElement.innerXMLToken = new CollectionToken(this._collect.dataIndex);
    }

    collectEnd(token: CollectionToken): string {
        if (this._collect === null) {
            throw new Error("collectEnd() without active collection");
        }
        const collectedThis = this._collect.data.substring(token.startOffset, this._collect.dataIndex);
        this._collect.pending -= 1;
        if (this._collect.pending === 0) {
            this._collect = null;
        }
        return collectedThis;
    }

    collectAddChunk(chunk: string): void {
        if (this._collect !== null) {
            this._collect.data += chunk;
        }
    }

    collectNext() {
        if (this._collect === null) {
            return;
        }
        this._collect.dataIndex += 1;
    }
}

// deno-lint-ignore no-explicit-any
export type XMLParseEvent = [string, ...any[]];

export interface XMLParseHandler {
    (cx: XMLParseContext, c: string): XMLParseEvent[];
}

/** XML parsing error. the parser convert this error to "error" event. */
export class XMLParseError extends Error {
    private _position: XMLPosition;

    constructor(message: string, cx: XMLParseContext) {
        super(message);
        this._position = cx.position;
    }

    /** line number on XML source */
    get line(): number {
        return this._position.line;
    }

    /** column number on XML source */
    get column(): number {
        return this._position.column;
    }
}
