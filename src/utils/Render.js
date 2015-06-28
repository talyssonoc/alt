import React from 'react'

function call(f) {
  if (typeof f === 'function') f()
}

function usingDispatchBuffer(buffer, Component) {
  return React.createClass({
    childContextTypes: {
      universalId: React.PropTypes.string.isRequired,
      buffer: React.PropTypes.object.isRequired
    },

    getChildContext() {
      return {
        universalId: 'root',
        buffer
      }
    },

    render() {
      return React.createElement(Component, this.props)
    }
  })
}

class DispatchBuffer {
  constructor(renderStrategy) {
    this.promisesBuffer = []
    this.fetched = {}
    this.fulfilled = {}
    this.dispatches = []
    this.renderStrategy = renderStrategy
  }

  push(id, promise) {
    this.promisesBuffer.push(promise)
    promise.then(() => this.fulfilled[id] = true)
    this.fetched[id] = true
  }

  shouldFetch(id) {
    return !this.fetched[id]
  }

  shouldRender(id) {
    return this.fulfilled[id]
  }

  clear() {
    this.promisesBuffer = []
  }

  resolve(error, html, alt, Element, i) {
    return Promise.resolve({
      error,
      html,
      state: alt.flush(),
      fulfilled: this.fulfilled,
      element: Element,
      diagnostics: {
        iterations: i,
        dispatches: this.dispatches.length
      }
    })
  }

  // XXX need to add a timeout/iteration limit
  // XXX study a fail case, make sure when it does fail it sends down partial markup of what was already resolved. we can client render the rest
  render(alt, Element, i = 0) {
    alt.recycle()

    // fire off all the actions synchronously
    this.dispatches.forEach((f) => {
      if (Array.isArray(f)) {
        f.forEach(call)
      } else {
        call(f)
      }
    })

    // render the html
    const html = this.renderStrategy(Element)

    // do we have new async queries we need to take care of?
    if (this.promisesBuffer.length) {
      // resolve them
      return Promise.all(this.promisesBuffer).then((data) => {
        // add the dispatches to our queue
        this.dispatches = this.dispatches.concat(data)

        // clear the buffer and call render again
        this.promisesBuffer = []

        return this.render(alt, Element, i + 1)
      }).catch((error) => {
        return this.resolve(error, html, alt, Element, i)
      })
    } else {
      return this.resolve(null, html, alt, Element, i)
    }
    // XXX enhancement: we also should probably cache same calls with same args and just return the promise in that instance.
  }
}

function renderWithStrategy(strategy) {
  return (alt, Component, props) => {
    alt.buffer = true

    // create a buffer and use context to pass it through to the components
    const buffer = new DispatchBuffer((Node) => {
      return React[strategy](Node)
    })
    const Container = usingDispatchBuffer(buffer, Component)

    // cache the element
    const Element = React.createElement(Container, props)

    const start = Date.now()

    return buffer.render(alt, Element).then((obj) => {
      const time = Date.now() - start

      return {
        error: obj.error,
        html: obj.html,
        state: obj.state,
        fulfilled: obj.fulfilled,
        element: obj.element,
        diagnostics: {
          iterations: obj.diagnostics.iterations,
          dispatches: obj.diagnostics.dispatches,
          time
        }
      }
    })
  }
}

export default class Render {
  constructor(alt, options = {}) {
    this.alt = alt
    this.options = options
  }

  toString(Component, props) {
    return renderWithStrategy('renderToString')(this.alt, Component, props)
  }

  toStaticMarkup(Component, props) {
    return renderWithStrategy('renderToStaticMarkup')(this.alt, Component, props)
  }

  toDOM(Component, props, documentNode, opts = {}) {
    const buffer = new DispatchBuffer()

    if (opts.fulfilled) buffer.fulfilled = opts.fulfilled
    const Node = usingDispatchBuffer(buffer, Component)
    const Element = React.createElement(Node, props)
    buffer.clear()
    return React.render(Element, documentNode)
  }

  static resolve(fetch, MaybeComponent) {
    function bind(Component) {
      return React.createClass({
        contextTypes: {
          universalId: React.PropTypes.string.isRequired,
          buffer: React.PropTypes.object.isRequired
        },

        childContextTypes: {
          universalId: React.PropTypes.string.isRequired,
          buffer: React.PropTypes.object.isRequired
        },

        getChildContext() {
          const children = this.props.children || []
          const universalId = `${this.context.universalId}.${children.length}`
          return {
            universalId,
            buffer: this.context.buffer
          }
        },

        componentWillMount() {
          if (this.context.buffer.shouldFetch(this.context.universalId)) {
            this.context.buffer.push(
              this.context.universalId,
              fetch(this.props)
            )
          }
        },

        render() {
          return this.context.buffer.shouldRender(this.context.universalId)
            ? React.createElement(Component, this.props)
            : null
        }
      })
    }

    // works as a decorator or as a function
    return MaybeComponent ? bind(MaybeComponent) : Component => bind(Component)
  }
}
